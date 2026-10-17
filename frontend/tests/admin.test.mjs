import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';

const require = createRequire(import.meta.url);
function load(path, stubs = {}, globals = {}) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const context = {
    exports: {},
    URL,
    URLSearchParams,
    FormData,
    Headers,
    AbortSignal,
    crypto,
    ...globals,
    require: (name) => (name in stubs ? stubs[name] : require(name)),
  };
  vm.runInNewContext(compiled, context, { filename: path });
  return context.exports;
}

const stateMachine = load('src/features/admin/lib/orderStateMachine.ts');
const {
  validateOrderTransition,
  getAllowedNextOrderStatuses,
  validateDeliveryTransition,
  validatePaymentApproval,
  computePostPaymentApprovalState,
  validateRefundCompletion,
  validateStockAdjustment,
  isAuthorizedOwnerAdmin,
} = stateMachine;

/* ================================================================== */
/*  1. ROLE & ROUTE AUTHORIZATION TESTS                               */
/* ================================================================== */

let fakeFetch;
const env = { apiBaseUrl: 'https://api.balajifaki.test/api', supportWhatsApp: '918000961030' };
let session = { access_token: 'owner-admin-jwt-token', user: { id: 'admin-1', email: 'owner@balajifaki.com' } };
const authStub = {
  supabase: { auth: { getSession: async () => ({ data: { session } }) } },
  useSession: () => ({ session, loading: false }),
};
const apiModule = load(
  'src/lib/api.ts',
  { './env': { env }, './supabase': authStub },
  { fetch: (...args) => fakeFetch(...args) },
);
const adminApi = load('src/features/admin/api/index.ts', {
  '../../../lib/api': apiModule,
  '../../../lib/env': { env },
});
const routeGuard = load('src/features/admin/components/AdminRouteGuard.tsx', {
  '../../../lib/supabase': authStub,
  '../../../lib/env': { env },
  '../../../components/common/Notice': { default: () => null },
  '../api': adminApi,
  '../lib/orderStateMachine': stateMachine,
});

// Unauthenticated user cannot access admin routes
assert.equal(isAuthorizedOwnerAdmin(null), false);
assert.equal(
  routeGuard.evaluateAdminRouteAccess({
    user: null,
    serverRole: null,
    apiConnected: true,
  }).allowed,
  false,
);
assert.equal(
  routeGuard.evaluateAdminRouteAccess({
    user: null,
    serverRole: null,
    apiConnected: true,
  }).status,
  'DENIED_UNAUTHENTICATED',
);

// Customer cannot access admin routes even if devPreviewAcknowledged is true
assert.equal(isAuthorizedOwnerAdmin({ role: 'CUSTOMER' }), false);
assert.equal(
  routeGuard.evaluateAdminRouteAccess({
    user: { id: 'cust-1', email: 'customer@example.com', user_metadata: { role: 'CUSTOMER' } },
    serverRole: 'CUSTOMER',
    apiConnected: false,
    devPreviewAcknowledged: true,
  }).allowed,
  false,
);
assert.equal(
  routeGuard.evaluateAdminRouteAccess({
    user: { id: 'cust-1', email: 'customer@example.com' },
    serverRole: 'CUSTOMER',
    apiConnected: true,
  }).status,
  'DENIED_CUSTOMER',
);

// Owner Admin verified by server is allowed
assert.equal(isAuthorizedOwnerAdmin({ role: 'OWNER_ADMIN' }), true);
assert.equal(
  routeGuard.evaluateAdminRouteAccess({
    user: { id: 'admin-1', email: 'owner@balajifaki.com' },
    serverRole: 'OWNER_ADMIN',
    apiConnected: true,
  }).allowed,
  true,
);

/* ================================================================== */
/*  2. ORDER & PAYMENT SEPARATION INVARIANTS                          */
/* ================================================================== */

// Admin cannot confirm an unpaid or unverified order
for (const unverified of ['PENDING', 'SUBMITTED', 'UNDER_REVIEW', 'REJECTED']) {
  const check = validateOrderTransition({
    currentStatus: 'AWAITING_CONFIRMATION',
    nextStatus: 'CONFIRMED',
    paymentStatus: unverified,
  });
  assert.equal(check.allowed, false, `Must reject confirmation when payment is ${unverified}`);
  assert.match(check.reason, /VERIFIED/);
}

// Admin cannot confirm an order when stock is insufficient
assert.equal(
  validateOrderTransition({
    currentStatus: 'AWAITING_CONFIRMATION',
    nextStatus: 'CONFIRMED',
    paymentStatus: 'VERIFIED',
    availableStockSufficient: false,
  }).allowed,
  false,
);

// Admin can confirm an order when in AWAITING_CONFIRMATION and payment is VERIFIED
assert.equal(
  validateOrderTransition({
    currentStatus: 'AWAITING_CONFIRMATION',
    nextStatus: 'CONFIRMED',
    paymentStatus: 'VERIFIED',
    availableStockSufficient: true,
  }).allowed,
  true,
);

// Unverified payment cannot move to packing
for (const unverified of ['PENDING', 'SUBMITTED', 'UNDER_REVIEW', 'REJECTED']) {
  const check = validateOrderTransition({
    currentStatus: 'CONFIRMED',
    nextStatus: 'PACKING',
    paymentStatus: unverified,
  });
  assert.equal(check.allowed, false);
  assert.match(check.reason, /Unverified payment cannot move to packing/);
}

// Packing cannot begin until order is CONFIRMED (even if payment is VERIFIED)
assert.equal(
  validateOrderTransition({
    currentStatus: 'AWAITING_CONFIRMATION',
    nextStatus: 'PACKING',
    paymentStatus: 'VERIFIED',
  }).allowed,
  false,
);

// Payment approval transitions order to AWAITING_CONFIRMATION, never PACKING or SHIPPED
const postApproval = computePostPaymentApprovalState();
assert.equal(postApproval.paymentStatus, 'VERIFIED');
assert.equal(postApproval.orderStatus, 'AWAITING_CONFIRMATION');
assert.notEqual(postApproval.orderStatus, 'PACKING');
assert.notEqual(postApproval.orderStatus, 'SHIPPED');

/* ================================================================== */
/*  3. MANUAL PAYMENT VERIFICATION RULES                              */
/* ================================================================== */

const validApprovalInput = {
  receivingBankAccount: 'HDFC Bank •••• 4821',
  verifiedAmount: 420,
  verifiedUtr: '429104857123',
  bankCreditReference: 'HDFC-CR-20261017-991',
  transactionStatus: 'CREDITED',
  verificationNote: 'Verified in merchant statement.',
};

assert.equal(
  validatePaymentApproval({
    currentPaymentStatus: 'UNDER_REVIEW',
    expectedAmount: 420,
    submittedUtr: '429104857123',
    approvalInput: validApprovalInput,
  }).allowed,
  true,
);

// Duplicate payment approval is blocked
assert.equal(
  validatePaymentApproval({
    currentPaymentStatus: 'VERIFIED',
    expectedAmount: 420,
    submittedUtr: '429104857123',
    approvalInput: validApprovalInput,
  }).allowed,
  false,
);

// Duplicate UTR across orders is blocked
assert.equal(
  validatePaymentApproval({
    currentPaymentStatus: 'SUBMITTED',
    expectedAmount: 420,
    submittedUtr: '429104857123',
    approvalInput: validApprovalInput,
    existingVerifiedUtrs: ['429104857123'],
  }).allowed,
  false,
);

// Duplicate bank credit reference is blocked
assert.equal(
  validatePaymentApproval({
    currentPaymentStatus: 'SUBMITTED',
    expectedAmount: 420,
    submittedUtr: '429104857123',
    approvalInput: validApprovalInput,
    existingBankCreditRefs: ['HDFC-CR-20261017-991'],
  }).allowed,
  false,
);

// Mismatched amount is blocked
assert.equal(
  validatePaymentApproval({
    currentPaymentStatus: 'SUBMITTED',
    expectedAmount: 420,
    submittedUtr: '429104857123',
    approvalInput: { ...validApprovalInput, verifiedAmount: 400 },
  }).allowed,
  false,
);

// Mismatched UTR vs customer submitted UTR is blocked
assert.equal(
  validatePaymentApproval({
    currentPaymentStatus: 'SUBMITTED',
    expectedAmount: 420,
    submittedUtr: '429104857123',
    approvalInput: { ...validApprovalInput, verifiedUtr: '999999999999' },
  }).allowed,
  false,
);

/* ================================================================== */
/*  4. ORDER & DELIVERY STEP-SKIPPING AND CANCELLED ORDER BLOCKING    */
/* ================================================================== */

// Cannot skip steps (e.g. CONFIRMED -> SHIPPED or PACKING -> OUT_FOR_DELIVERY)
assert.equal(
  validateOrderTransition({
    currentStatus: 'CONFIRMED',
    nextStatus: 'SHIPPED',
    paymentStatus: 'VERIFIED',
  }).allowed,
  false,
);
assert.equal(validateDeliveryTransition('CONFIRMED', 'SHIPPED').allowed, false);
assert.equal(validateDeliveryTransition('PACKING', 'OUT_FOR_DELIVERY').allowed, false);
assert.equal(validateDeliveryTransition('PACKED', 'PICKED_UP').allowed, true);

// Cancelled orders cannot be shipped, packed, or modified
for (const target of ['CONFIRMED', 'PACKING', 'PACKED', 'PICKED_UP', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED']) {
  const check = validateOrderTransition({
    currentStatus: 'CANCELLED',
    nextStatus: target,
    paymentStatus: 'VERIFIED',
  });
  assert.equal(check.allowed, false, `Cancelled order must not transition to ${target}`);
}
assert.equal(getAllowedNextOrderStatuses('CANCELLED', 'VERIFIED').length, 0);

/* ================================================================== */
/*  5. REFUND COMPLETION & STOCK ADJUSTMENT RULES                     */
/* ================================================================== */

// Refund cannot be marked COMPLETED without verified bank reference, bank account, date, and matching amount
assert.equal(
  validateRefundCompletion({
    currentRefundStatus: 'APPROVED',
    expectedRefundAmount: 350,
    transferInput: {
      refundTransactionReference: '',
      refundBankAccount: 'HDFC •••• 4821',
      refundDate: '2026-10-17',
      verifiedAmount: 350,
    },
  }).allowed,
  false,
);

assert.equal(
  validateRefundCompletion({
    currentRefundStatus: 'PENDING',
    expectedRefundAmount: 350,
    transferInput: {
      refundTransactionReference: 'NEFT982374892',
      refundBankAccount: 'HDFC •••• 4821',
      refundDate: '2026-10-17',
      verifiedAmount: 350,
    },
  }).allowed,
  false,
);

assert.equal(
  validateRefundCompletion({
    currentRefundStatus: 'PROCESSING',
    expectedRefundAmount: 350,
    transferInput: {
      refundTransactionReference: 'NEFT982374892',
      refundBankAccount: 'HDFC •••• 4821',
      refundDate: '2026-10-17',
      verifiedAmount: 350,
    },
  }).allowed,
  true,
);

// Negative available stock is rejected
assert.equal(
  validateStockAdjustment({
    currentAvailableStock: 10,
    request: {
      variantId: 'var-faki-500g',
      adjustmentType: 'DEDUCT',
      quantity: 11,
      reason: 'Damaged packets during storage inspection',
    },
  }).allowed,
  false,
);

assert.equal(
  validateStockAdjustment({
    currentAvailableStock: 10,
    request: {
      variantId: 'var-faki-500g',
      adjustmentType: 'DEDUCT',
      quantity: 4,
      reason: 'Damaged packets during storage inspection',
    },
  }).allowed,
  true,
);

/* ================================================================== */
/*  6. TYPED ADMIN API CLIENT & HEADERS                               */
/* ================================================================== */

assert.equal(adminApi.resolveApiPath('/api/admin/orders'), '/admin/orders');
assert.equal(
  adminApi.buildQueryString({ search: 'BFP', status: 'ALL', page: 1, empty: '' }),
  '?search=BFP&page=1',
);

let capturedRequest = null;
fakeFetch = async (url, options) => {
  capturedRequest = { url, options };
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
};

await adminApi.approveAdminPayment('pay-101', validApprovalInput);
assert.equal(capturedRequest.url, 'https://api.balajifaki.test/api/admin/payments/pay-101/approve');
assert.equal(capturedRequest.options.method, 'POST');
assert.equal(capturedRequest.options.headers.get('Authorization'), 'Bearer owner-admin-jwt-token');
assert.equal(
  capturedRequest.options.headers.get('Idempotency-Key'),
  'admin-approve-payment-pay-101-429104857123',
);

/* ================================================================== */
/*  7. SUPABASE POSTGRESQL SCHEMA & RLS MIGRATION VERIFICATION        */
/* ================================================================== */

const migrationSql = readFileSync(
  new URL('../../supabase/migrations/20261017000000_balaji_faki_point_schema.sql', import.meta.url),
  'utf8',
);

const requiredTables = [
  'user_profiles',
  'customers',
  'products',
  'product_variants',
  'orders',
  'order_items',
  'payment_attempts',
  'bank_credits',
  'order_status_history',
  'inventory_movements',
  'shipments',
  'delivery_events',
  'reviews',
  'cancellation_requests',
  'refunds',
  'notifications',
  'store_settings',
  'admin_audit_logs',
];

for (const table of requiredTables) {
  assert.match(
    migrationSql,
    new RegExp(`create table if not exists public\\.${table}\\b`),
    `Missing table definition for public.${table}`,
  );
  assert.match(
    migrationSql,
    new RegExp(`alter table public\\.${table} enable row level security;`),
    `Missing RLS enablement for public.${table}`,
  );
}

const sqlWithoutComments = migrationSql.replace(/--.*$/gm, '');
assert.doesNotMatch(sqlWithoutComments, /auth\.role\(\)/, 'Must not use deprecated auth.role() in RLS policies');
assert.match(migrationSql, /create or replace function private\.is_owner_admin\(\)/);
assert.match(migrationSql, /'payment-proofs'/);
assert.match(migrationSql, /cost_price_paise/);
assert.match(migrationSql, /unit_cost_paise/);

/* ================================================================== */
/*  8. DASHBOARD METRICS (PRODUCTS SOLD & NET PROFIT) & ACTION FLOW   */
/* ================================================================== */

const {
  calculateProductsSold,
  calculateNetProfit,
  getAllowedOrderActions,
} = stateMachine;
const refData = load('src/features/admin/lib/referenceData.ts');

// Products Sold counts total product units from DELIVERED + VERIFIED orders
assert.equal(calculateProductsSold(refData.SAMPLE_ADMIN_ORDERS), 1);
assert.equal(calculateProductsSold(refData.SAMPLE_ADMIN_ORDERS, 18), 18);

// Net Profit returns null ("Not configured") when cost prices or selling prices are null
assert.equal(
  calculateNetProfit({
    orders: refData.SAMPLE_ADMIN_ORDERS,
    products: refData.SAMPLE_ADMIN_PRODUCTS,
    refunds: refData.SAMPLE_ADMIN_REFUNDS,
  }),
  null,
);

// Net Profit accurately computes revenue - product costs - delivery expenses - completed refunds when configured
const configuredOrders = [
  {
    ...refData.SAMPLE_ADMIN_ORDERS[3], // DELIVERED + VERIFIED
    orderStatus: 'DELIVERED',
    paymentStatus: 'VERIFIED',
    totalAmount: 550,
    deliveryCharges: 40,
    items: [
      {
        id: 'item-1',
        variantId: 'var-faki-500g',
        productType: 'faki',
        productName: 'Faki',
        productNameGu: 'ફાકી',
        packSize: '500g',
        quantity: 2,
        unitPrice: 255,
        unitCostPrice: 150,
        lineTotal: 510,
        productImage: '/images/hero-product.jpg',
      },
    ],
  },
];
const configuredRefunds = [
  {
    ...refData.SAMPLE_ADMIN_REFUNDS[0],
    refundStatus: 'COMPLETED',
    refundAmount: 30,
  },
];
// Revenue (550) - Cost (2 * 150 = 300) - Delivery (40) - Refund (30) = 180
assert.equal(
  calculateNetProfit({
    orders: configuredOrders,
    products: refData.SAMPLE_ADMIN_PRODUCTS,
    refunds: configuredRefunds,
  }),
  180,
);

// Order Management state machine action buttons follow exact sequence
const expectedStepAction = [
  ['AWAITING_CONFIRMATION', 'CONFIRMED', 'Confirm Order'],
  ['CONFIRMED', 'PACKING', 'Start Packing'],
  ['PACKING', 'PACKED', 'Mark Packed'],
  ['PACKED', 'PICKED_UP', 'Mark Picked Up'],
  ['PICKED_UP', 'SHIPPED', 'Mark Shipped'],
  ['SHIPPED', 'OUT_FOR_DELIVERY', 'Mark Out for Delivery'],
  ['OUT_FOR_DELIVERY', 'DELIVERED', 'Mark Delivered'],
];
for (const [status, expectedNext, expectedLabel] of expectedStepAction) {
  const actions = getAllowedOrderActions(status, 'VERIFIED');
  assert.equal(actions[0].nextStatus, expectedNext);
  assert.equal(actions[0].label, expectedLabel);
}
assert.equal(getAllowedOrderActions('DELIVERED', 'VERIFIED').length, 0);
assert.equal(getAllowedOrderActions('CANCELLED', 'VERIFIED').length, 0);

/* ================================================================== */
/*  9. PRIMARY ADMIN NAVIGATION & 4-PAGE SSR RENDERING VERIFICATION   */
/* ================================================================== */

const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { MemoryRouter } = require('react-router-dom');

const NoticeMod = load('src/components/common/Notice.tsx');
const StatCardMod = load('src/features/admin/components/StatCard.tsx');
const StatusBadgeMod = load('src/features/admin/components/StatusBadge.tsx', {
  '../lib/orderStateMachine': stateMachine,
});
const DetailDrawerMod = load('src/features/admin/components/DetailDrawer.tsx');
const ConfirmDialogMod = load('src/features/admin/components/ConfirmDialog.tsx');
const ImagePreviewMod = load('src/features/admin/components/ImagePreview.tsx');
const AdminTimelineMod = load('src/features/admin/components/AdminTimeline.tsx');
const AdminStatesMod = load('src/features/admin/components/AdminStates.tsx', {
  '../../../components/common/Notice': NoticeMod,
});
const AdminToastMod = load('src/features/admin/components/Toast.tsx');
const AdminSidebarMod = load('src/features/admin/components/AdminSidebar.tsx', {
  '../../../lib/supabase': authStub,
});

// Verify primary navigation contains strictly the 4 simplified pages
const navItems = AdminSidebarMod.ADMIN_NAV_GROUPS.flatMap((g) => g.items);
assert.deepEqual(
  JSON.parse(JSON.stringify(navItems.map((i) => ({ label: i.label, to: i.to })))),
  [
    { label: 'Dashboard', to: '/admin/dashboard' },
    { label: 'Price Management', to: '/admin/prices' },
    { label: 'Order Management', to: '/admin/orders' },
    { label: 'Feedback Management', to: '/admin/feedback' },
  ],
);

const adminComponentsBarrel = {
  StatCard: StatCardMod.default,
  StatusBadge: StatusBadgeMod.default,
  DetailDrawer: DetailDrawerMod.default,
  ConfirmDialog: ConfirmDialogMod.default,
  ImagePreview: ImagePreviewMod.default,
  AdminTimeline: AdminTimelineMod.default,
  LoadingSkeleton: AdminStatesMod.LoadingSkeleton,
  useAdminToast: () => ({ showToast: () => {} }),
  AdminToastProvider: AdminToastMod.AdminToastProvider,
};

const offlineEnv = { apiBaseUrl: '', supportWhatsApp: '918000961030' };
const commonPageStubs = {
  '../../../components/common/Notice': NoticeMod,
  '../../../lib/env': { env: offlineEnv },
  '../../../lib/api': apiModule,
  '../api': adminApi,
  '../lib/referenceData': refData,
  '../lib/orderStateMachine': stateMachine,
  '../components': adminComponentsBarrel,
};

const DashboardPage = load('src/features/admin/pages/AdminDashboardPage.tsx', commonPageStubs).default;
const PricesPage = load('src/features/admin/pages/AdminProductsPage.tsx', commonPageStubs).default;
const OrdersPage = load('src/features/admin/pages/AdminOrdersPage.tsx', commonPageStubs).default;
const FeedbackPage = load('src/features/admin/pages/AdminReviewsPage.tsx', commonPageStubs).default;

const dashboardHtml = renderToStaticMarkup(
  React.createElement(MemoryRouter, { initialEntries: ['/admin/dashboard'] }, React.createElement(DashboardPage)),
);
assert.match(dashboardHtml, /Products Sold/);
assert.match(dashboardHtml, /1 Item/);
assert.match(dashboardHtml, /Net Profit/);
assert.match(dashboardHtml, /Not configured/);
assert.match(dashboardHtml, /Pending Payment Confirmations/);
for (const col of [
  'Order ID',
  'Customer Name',
  'Product',
  'Total Amount',
  'Payment UTR',
  'Payment Screenshot',
  'Submitted Date',
  'Payment Status',
  'Review Payment Action',
]) {
  assert.match(dashboardHtml, new RegExp(col), `Dashboard table missing column: ${col}`);
}
assert.doesNotMatch(dashboardHtml, /Sales &amp; Order Volume Overview/);
assert.doesNotMatch(dashboardHtml, /Recent Admin Audit Activity/);

const pricesHtml = renderToStaticMarkup(
  React.createElement(MemoryRouter, { initialEntries: ['/admin/prices'] }, React.createElement(PricesPage)),
);
assert.match(pricesHtml, /Price Management/);
for (const col of ['Product', 'Pack Size', 'Cost Price', 'Selling Price', 'Action']) {
  assert.match(pricesHtml, new RegExp(col), `Price Management missing column: ${col}`);
}
assert.match(pricesHtml, /250g/);
assert.match(pricesHtml, /500g/);
assert.match(pricesHtml, /1kg/);

const ordersHtml = renderToStaticMarkup(
  React.createElement(MemoryRouter, { initialEntries: ['/admin/orders'] }, React.createElement(OrdersPage)),
);
assert.match(ordersHtml, /Order Management/);
for (const col of [
  'Order ID',
  'Customer',
  'Product',
  'Quantity',
  'Total Amount',
  'Payment Status',
  'Order Status',
  'Order Date',
  'Action',
]) {
  assert.match(ordersHtml, new RegExp(col), `Order Management missing column: ${col}`);
}
assert.match(ordersHtml, /Confirm Order/);
assert.match(ordersHtml, /Start Packing/);

const feedbackHtml = renderToStaticMarkup(
  React.createElement(MemoryRouter, { initialEntries: ['/admin/feedback'] }, React.createElement(FeedbackPage)),
);
assert.match(feedbackHtml, /Feedback Management/);
assert.match(feedbackHtml, /Star Rating/);
assert.match(feedbackHtml, /View \/ Reply/);

console.log(
  'Admin panel & Supabase DB: 18 tables, RLS policies, RBAC route guard, 4-page navigation, minimal Dashboard (Products Sold + Net Profit + Pending Payment Confirmations), Price Management, Order Management, Feedback Management, and typed API client passed.',
);


