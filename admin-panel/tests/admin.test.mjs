import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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

// The Admin Panel is its own app (admin-panel/frontend): admin routes only, and the storefront ships no admin code.
const appSource = readFileSync(new URL('../src/app/App.tsx', import.meta.url), 'utf8');
assert.match(appSource, /<Route path="admin" element=\{<AdminLayout \/>\}>/, 'admin pages sit under /admin');
assert.match(appSource, /<Route path="\*" element=\{<Navigate to="\/admin\/dashboard"/, 'every other path lands on the dashboard');
// Self-contained like D&D/Admin: nothing under admin-panel/src reaches outside admin-panel.
function sourceFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = `${dir}/${name}`;
    return statSync(full).isDirectory() ? sourceFiles(full) : /\.(tsx?|css)$/.test(name) ? [full] : [];
  });
}
const srcDir = fileURLToPath(new URL('../src', import.meta.url)).split(String.fromCharCode(92)).join('/');
for (const file of sourceFiles(srcDir)) {
  const text = readFileSync(file, 'utf8');
  assert.doesNotMatch(text, /@shared\/|frontend\/src/, `${file} must not import the storefront`);
  for (const [, spec] of text.matchAll(/from\s+'(\.[^']+)'/g)) {
    const depth = file.slice(srcDir.length).split('/').length - 2;
    assert.ok(spec.split('/').filter((part) => part === '..').length <= depth, `${file} imports ${spec} from outside src`);
  }
}

const customersSource = readFileSync(new URL('../src/features/admin/pages/AdminCustomersPage.tsx', import.meta.url), 'utf8');
assert.doesNotMatch(customersSource, /SAMPLE_|Development reference|XXX XX/, 'the customers screen shows real accounts only');
assert.match(customersSource, /getAdminCustomers\(/, 'customers come from the server');
assert.doesNotMatch(customersSource, /method:\s*'(POST|PATCH|DELETE|PUT)'/, 'customers are read-only');

const stateMachine = load('src/features/admin/lib/orderStateMachine.ts');
const {
  validateOrderTransition,
  getAllowedNextOrderStatuses,
  validateDeliveryTransition,
  computePostPaymentApprovalState,
  validateRefundCompletion,
  validateStockAdjustment,
} = stateMachine;

/* ================================================================== */
/*  1. ROLE & ROUTE AUTHORIZATION TESTS                               */
/* ================================================================== */

let fakeFetch;
const env = { apiBaseUrl: 'https://api.balajifaki.test/api', supportWhatsApp: '918000961030' };
let session = { access_token: 'owner-admin-jwt-token', user: { id: 'admin-1', email: 'owner@balajifaki.com' } };
const authStub = {
  getAccessToken: async () => session?.access_token ?? null,
  signOut: async () => {},
  useSession: () => ({ session, loading: false }),
};
const apiModule = load(
  'src/lib/api.ts',
  { './env': { env }, './auth': authStub },
  { fetch: (...args) => fakeFetch(...args) },
);
const adminApi = load('src/features/admin/api/index.ts', {
  '../../../lib/api': apiModule,
  '../../../lib/env': { env },
});
const routeGuard = load('src/features/admin/components/AdminRouteGuard.tsx', {
  '../../../lib/auth': authStub,
  '../../../lib/env': { env },
  './AdminSignIn': { default: () => null },
  './StoreLink': { default: () => null },
  '../../../components/common/Notice': { default: () => null },
  '../api': adminApi,
});
const evaluate = routeGuard.evaluateAdminRouteAccess;

// Unauthenticated user cannot access admin routes.
assert.equal(evaluate({ user: null, serverRole: null, apiConnected: true }).allowed, false);
assert.equal(evaluate({ user: null, serverRole: null, apiConnected: true }).status, 'DENIED_UNAUTHENTICATED');

// Customers are denied.
assert.equal(evaluate({ user: { id: 'cust-1' }, serverRole: 'CUSTOMER', apiConnected: true }).status, 'DENIED_CUSTOMER');
assert.equal(evaluate({ user: { id: 'cust-1' }, serverRole: 'CUSTOMER', apiConnected: false }).allowed, false);

// Only a successful server check (GET /api/me -> OWNER_ADMIN) opens the Admin Panel.
assert.equal(evaluate({ user: { id: 'admin-1' }, serverRole: 'OWNER_ADMIN', apiConnected: true }).allowed, true);
assert.equal(evaluate({ user: { id: 'admin-1' }, serverRole: 'OWNER_ADMIN', apiConnected: true }).status, 'AUTHORIZED_ADMIN');

// If /api/me failed (no server role) or the API is not configured, the panel stays locked even for a user whose
// browser-held claims say OWNER_ADMIN: claims never unlock the UI.
const forged = { id: 'attacker-1', email: 'attacker@example.com', app_metadata: { role: 'OWNER_ADMIN' }, user_metadata: { role: 'OWNER_ADMIN' } };
assert.equal(evaluate({ user: forged, serverRole: null, apiConnected: true }).allowed, false);
assert.equal(evaluate({ user: forged, serverRole: null, apiConnected: true }).status, 'DENIED_UNVERIFIED');
assert.equal(evaluate({ user: forged, serverRole: 'OWNER_ADMIN', apiConnected: false }).allowed, false);
assert.equal(evaluate({ user: forged, serverRole: 'CUSTOMER', apiConnected: true }).allowed, false);
assert.equal(typeof stateMachine.isAuthorizedOwnerAdmin, 'undefined', 'claim-based admin shortcut must not exist');
const guardSource = readFileSync(new URL('../src/features/admin/components/AdminRouteGuard.tsx', import.meta.url), 'utf8');
assert.doesNotMatch(guardSource, /user_profiles|app_metadata|user_metadata/, 'the guard reads no browser claims or tables');
assert.doesNotMatch(guardSource, /@gmail\.com|@example\./, 'no personal e-mail placeholder');

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

await adminApi.approveAdminPayment('pay-101', { notes: 'Screenshot checked' });
assert.equal(capturedRequest.url, 'https://api.balajifaki.test/api/admin/payments/pay-101/approve');
assert.equal(capturedRequest.options.method, 'POST');
assert.deepEqual(JSON.parse(capturedRequest.options.body), { notes: 'Screenshot checked' }, 'only a note is sent: no UTR or bank details');
assert.equal(capturedRequest.options.headers.get('Authorization'), 'Bearer owner-admin-jwt-token');
assert.equal(
  capturedRequest.options.headers.get('Idempotency-Key'),
  'admin-approve-payment-pay-101',
);

await adminApi.getAdminProducts();
assert.equal(capturedRequest.url, 'https://api.balajifaki.test/api/admin/products');
assert.equal(capturedRequest.options.cache, 'no-store');
assert.ok(capturedRequest.options.signal, 'catalog requests have a timeout');
await adminApi.getAdminInventory();
assert.equal(capturedRequest.url, 'https://api.balajifaki.test/api/admin/inventory');
assert.equal(capturedRequest.options.cache, 'no-store');
await adminApi.createStockAdjustment({ inventoryItemId: 'v1', productId: 'p1', packSize: '250g', adjustmentType: 'ADD', quantity: 10, reason: 'Fresh batch' });
assert.deepEqual(JSON.parse(capturedRequest.options.body), { inventoryItemId: 'v1', adjustmentType: 'ADD', quantity: 10, reason: 'Fresh batch' });
fakeFetch = async () => { throw new Error('network offline'); };
await assert.rejects(adminApi.getAdminProducts(), /Cannot reach the Balaji Faki Point server/);
fakeFetch = async () => new Response('<html>SPA fallback</html>', { status: 200 });
await assert.rejects(adminApi.getAdminProducts(), /unreadable response/);
fakeFetch = async () => new Response(JSON.stringify({ detail: 'Catalog database unavailable' }), { status: 503 });
await assert.rejects(adminApi.getAdminProducts(), /Catalog database unavailable/);

/* ================================================================== */
/*  7. NEON POSTGRESQL SCHEMA VERIFICATION                            */
/* ================================================================== */

const migrationSql = readFileSync(new URL('../../backend/migrations/neon/001_schema.sql', import.meta.url), 'utf8');
const requiredTables = [
  'user_profiles', 'customers', 'products', 'product_variants', 'orders', 'order_items', 'payment_attempts',
  'bank_credits', 'order_status_history', 'inventory_movements', 'shipments', 'delivery_events', 'reviews',
  'cancellation_requests', 'refunds', 'notifications', 'store_settings', 'admin_audit_logs',
  'review_photos', 'product_images', 'store_photos',
];
for (const table of requiredTables) {
  assert.match(migrationSql, new RegExp(`create table if not exists public\\.${table}\\b`), `Missing table definition for public.${table}`);
  assert.match(migrationSql, new RegExp(`alter table public\\.${table} enable row level security;`), `Missing RLS enablement for public.${table}`);
}
const sqlWithoutComments = migrationSql.replace(/--.*$/gm, '');
// Only the server-side API connects; nothing is granted to browser-facing or public roles.
assert.doesNotMatch(sqlWithoutComments, /\bgrant\b[^;]*\bto\s+(public|anon|authenticated)\b/i, 'no table is granted to public roles');
assert.match(migrationSql, /cost_price_paise/);
assert.match(migrationSql, /unit_cost_paise/);
assert.match(readFileSync(new URL('../../backend/migrations/neon/003_neon_identity.sql', import.meta.url), 'utf8'), /auth_subject text/,
  'historical accounts keep their IDs and link to a Neon Auth identity through auth_subject');

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
  '../../../lib/auth': authStub,
  './StoreLink': { default: () => null },
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
  EmptyState: AdminStatesMod.EmptyState,
  ErrorState: AdminStatesMod.ErrorState,
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
const PaymentsPage = load('src/features/admin/pages/AdminPaymentsPage.tsx', commonPageStubs).default;
const DeliveryPage = load('src/features/admin/pages/AdminDeliveryPage.tsx', commonPageStubs).default;
const InventoryPage = load('src/features/admin/pages/AdminInventoryPage.tsx', commonPageStubs).default;
const RefundsPage = load('src/features/admin/pages/AdminRefundsPage.tsx', commonPageStubs).default;

for (const pagePath of [
  'src/features/admin/pages/AdminDashboardPage.tsx',
  'src/features/admin/pages/AdminOrdersPage.tsx',
  'src/features/admin/pages/AdminProductsPage.tsx',
  'src/features/admin/pages/AdminPaymentsPage.tsx',
  'src/features/admin/pages/AdminDeliveryPage.tsx',
  'src/features/admin/pages/AdminInventoryPage.tsx',
  'src/features/admin/pages/AdminRefundsPage.tsx',
]) {
  assert.doesNotMatch(
    readFileSync(new URL(`../${pagePath}`, import.meta.url), 'utf8'),
    /SAMPLE_ADMIN_/,
    `${pagePath} must not render operational sample data`,
  );
}

const dashboardHtml = renderToStaticMarkup(
  React.createElement(MemoryRouter, { initialEntries: ['/admin/dashboard'] }, React.createElement(DashboardPage)),
);
assert.match(dashboardHtml, /Dashboard/);
assert.match(dashboardHtml, /Connect the local FastAPI server to see live figures\. No sample figures are shown/);
assert.doesNotMatch(dashboardHtml, /#BFP-|Products Sold/, 'offline dashboard shows no figures at all');
const { DashboardView } = load('src/features/admin/pages/AdminDashboardPage.tsx', commonPageStubs);
const view = (data) => renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(DashboardView, { data })));
const liveData = {
  productsSold: 12,
  netProfit: { amount: 3400, status: 'OK', reason: null, note: null },
  pendingPaymentConfirmations: [
    { paymentId: 'p1', orderId: 'o1', orderNumber: '#BFP-1001', customerName: 'Hetal Patel', amount: 1040, status: 'UNDER_REVIEW', submittedAt: '2026-10-19T10:00:00Z' },
  ],
};
const liveHtml = view(liveData);
for (const label of ['Products Sold', 'Net Profit', 'Pending Payment Confirmations', '#BFP-1001', 'Hetal Patel']) {
  assert.match(liveHtml, new RegExp(label), `Dashboard missing: ${label}`);
}
assert.match(liveHtml, />12</);
assert.ok(liveHtml.includes('/admin/payments?payment=p1'), 'each row links to payment review');
assert.match(liveHtml, /₹3,400/);
// Exactly three elements: no charts, extra metric cards or activity feeds.
assert.equal((liveHtml.match(/stat-card__label/g) ?? []).length, 2, 'two metric cards only');
assert.equal((liveHtml.match(/<table/g) ?? []).length, 1, 'one table only');
assert.doesNotMatch(liveHtml, /Sales|Recent|chart|Low stock|Pending refunds/i);
// Missing costs: never a fictional profit.
const unconfigured = view({ ...liveData, netProfit: { amount: null, status: 'NOT_CONFIGURED', reason: 'Cost price is not configured for: Faki 500g.', note: null } });
assert.match(unconfigured, /Not configured/);
assert.match(unconfigured, /Faki 500g/);
assert.doesNotMatch(unconfigured, /₹0/);
assert.match(view({ ...liveData, netProfit: { ...liveData.netProfit, note: 'Includes products whose prices or costs are development data not yet approved by the owner.' } }), /development data/);
assert.match(view({ ...liveData, pendingPaymentConfirmations: [] }), /No payment screenshots are waiting/);

// Settings: pure helpers - only changed fields are sent, PIN codes validated, nothing saved from placeholders.
const SettingsMod = load('src/features/admin/pages/AdminSettingsPage.tsx', { ...commonPageStubs, '../api': adminApi });
const baseSettings = {
  storeName: 'Balaji Faki Point', tagline: 'Fresh', storeAddress: 'Rajkot', phoneNumber: '+91 80009 61030', supportWhatsapp: '918000961030',
  supportEmail: '', businessHours: 'Call the store', shopIntro: '', productionInfo: '', providerManufacturer: '', packagingInfo: '',
  photos: [], officialUpiId: 'local-test@upi', officialPayeeName: 'LOCAL TEST - do not pay', officialUpiQrImageUrl: '',
  deliveryCharges: 0, freeDeliveryThreshold: null, serviceablePinCodes: ['360001', '360005'], lowStockThreshold: 10,
  stockReservationExpiryMinutes: 30, businessSettingsConfirmedAt: null, paymentIsLocalTest: true, adminAccount: { email: 'o@x.test', role: 'OWNER_ADMIN' },
};
const baseForm = SettingsMod.toForm(baseSettings);
assert.equal(JSON.stringify(SettingsMod.changedSettings(baseSettings, baseForm)), '{}', 'unchanged form sends nothing');
assert.equal(JSON.stringify(SettingsMod.changedSettings(baseSettings, { ...baseForm, tagline: 'Fresher' })), '{"tagline":"Fresher"}');
assert.equal(JSON.stringify(SettingsMod.changedSettings(baseSettings, { ...baseForm, deliveryCharges: '40', freeDeliveryThreshold: '1500' })), '{"deliveryCharges":40,"freeDeliveryThreshold":1500}');
assert.equal(JSON.stringify(SettingsMod.changedSettings(baseSettings, { ...baseForm, serviceablePinCodes: '360005, 360001' })), '{"serviceablePinCodes":["360005","360001"]}');
for (const bad of [{ serviceablePinCodes: '123' }, { serviceablePinCodes: '360001, 360001' }, { deliveryCharges: '-5' }, { deliveryCharges: 'abc' }, { lowStockThreshold: '1.5' }]) {
  assert.ok('error' in SettingsMod.changedSettings(baseSettings, { ...baseForm, ...bad }), JSON.stringify(bad));
}
assert.deepEqual(JSON.parse(JSON.stringify(SettingsMod.parsePinCodes('360001  360002,360003'))), ['360001', '360002', '360003']);
const settingsSource = readFileSync(new URL('../src/features/admin/pages/AdminSettingsPage.tsx', import.meta.url), 'utf8');
assert.doesNotMatch(settingsSource, /SAMPLE_|okbizaxis|dp334218|supabase\.auth\.updateUser/, 'no sample values or client-side credential handling');
const settingsHtml = renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(SettingsMod.default)));
assert.match(settingsHtml, /No sample values are shown/);
assert.doesNotMatch(settingsHtml, /Save changes/, 'nothing can be saved before the server answered');

// Price Management: only changed fields are sent; approving a price is explicit; nothing is cleared by accident.
const { buildVariantPatch } = load('src/features/admin/pages/AdminProductsPage.tsx', commonPageStubs);
const variant = { id: 'v1', packSize: '500g', sku: 'S', costPrice: 180, price: 500, availableQuantity: 5, reservedQuantity: 0, isAvailable: false, priceConfirmed: false };
const patchOf = (edit) => JSON.parse(JSON.stringify(buildVariantPatch(variant, { cost: '180', price: '500', available: false, approve: false, ...edit })));
assert.deepEqual(patchOf({}).patch, { packSize: '500g' }, 'an untouched row sends nothing');
assert.deepEqual(patchOf({ price: '550' }).patch, { packSize: '500g', price: 550 }, 'only the price');
assert.deepEqual(patchOf({ available: true }).patch, { packSize: '500g', isAvailable: true }, 'availability only when toggled');
assert.deepEqual(patchOf({ price: '550', approve: true }).patch, { packSize: '500g', price: 550, priceConfirmed: true });
assert.deepEqual(patchOf({ approve: true }).patch, { packSize: '500g', priceConfirmed: true }, 'approve the existing development price');
assert.deepEqual(patchOf({ cost: '' }).patch, { packSize: '500g', costPrice: null }, 'clearing is explicit');
for (const bad of [{ price: '-1' }, { price: 'abc' }, { cost: '-5' }, { price: '', approve: true }]) {
  assert.ok(patchOf(bad).error, JSON.stringify(bad));
}
const approved = { ...variant, priceConfirmed: true };
assert.deepEqual(JSON.parse(JSON.stringify(buildVariantPatch(approved, { cost: '180', price: '500', available: false, approve: true }).patch)), { packSize: '500g' }, 'already approved: no change');
assert.deepEqual(JSON.parse(JSON.stringify(buildVariantPatch(approved, { cost: '180', price: '500', available: false, approve: false }).patch)), { packSize: '500g', priceConfirmed: false }, 'unchecking approval persists revocation');
assert.deepEqual(JSON.parse(JSON.stringify(buildVariantPatch(approved, { cost: '180', price: '550', available: false, approve: false }).patch)), { packSize: '500g', price: 550, priceConfirmed: false }, 'a changed approved price needs fresh approval');
const productsSource = readFileSync(new URL('../src/features/admin/pages/AdminProductsPage.tsx', import.meta.url), 'utf8');
assert.doesNotMatch(productsSource, /createAdminProduct|imageUrl|SAMPLE_/, 'no create flow (fixed catalogue) and no free-text image URLs');

const pricesHtml = renderToStaticMarkup(
  React.createElement(MemoryRouter, { initialEntries: ['/admin/prices'] }, React.createElement(PricesPage)),
);
assert.match(pricesHtml, /Price Management/);
for (const col of ['Product', 'Pack Size', 'Cost Price', 'Selling Price', 'Action']) {
  assert.match(pricesHtml, new RegExp(col), `Price Management missing column: ${col}`);
}
assert.match(pricesHtml, /No sample product or price records are shown/);
assert.match(pricesHtml, /No products were returned by the catalog API/);
assert.doesNotMatch(pricesHtml, /Faki Premium Blend/);

// Exercise page callbacks and asynchronous load states without a DOM or extra test dependencies.
function mountPage(path, apiOverrides) {
  const values = [], dependencies = [], effects = [];
  let stateIndex = 0, effectIndex = 0, tree;
  const hooks = {
    ...React,
    useState(initial) {
      const index = stateIndex++;
      if (!(index in values)) values[index] = typeof initial === 'function' ? initial() : initial;
      return [values[index], (next) => { values[index] = typeof next === 'function' ? next(values[index]) : next; }];
    },
    useEffect(effect, deps) {
      const index = effectIndex++;
      if (!dependencies[index] || deps.some((value, i) => value !== dependencies[index][i])) effects.push(effect);
      dependencies[index] = deps;
    },
  };
  const Page = load(path, {
    ...commonPageStubs,
    react: hooks,
    'react-router-dom': { ...require('react-router-dom'), useSearchParams: () => [new URLSearchParams()] },
    '../../../lib/env': { env },
    '../api': { ...adminApi, ...apiOverrides },
  }).default;
  const render = () => { stateIndex = 0; effectIndex = 0; tree = Page(); return tree; };
  render();
  return {
    render,
    async settle() { effects.splice(0).forEach((effect) => effect()); await new Promise((resolve) => setImmediate(resolve)); return render(); },
    get nodes() {
      const walk = (node) => Array.isArray(node) ? node.flatMap(walk) : React.isValidElement(node) ? [node, ...walk(node.props.children)] : [];
      return walk(tree);
    },
    get html() { return renderToStaticMarkup(React.createElement(MemoryRouter, null, tree)); },
  };
}
const liveProduct = { id: 'p1', type: 'faki', name: 'Faki', nameGu: 'ફાકી', active: true, images: [], variants: [{ ...approved, isAvailable: true, availableQuantity: 0 }] };
let catalogLoads = 0, savedPrice;
const pricesPage = mountPage('src/features/admin/pages/AdminProductsPage.tsx', {
  getAdminProducts: async () => { if (++catalogLoads === 1) throw new apiModule.ApiError(503, 'FastAPI catalog unavailable'); return [liveProduct]; },
  updateAdminProduct: async (_id, payload) => { savedPrice = payload; return { ...liveProduct, variants: [{ ...liveProduct.variants[0], ...payload.variants[0] }] }; },
});
await pricesPage.settle();
assert.match(pricesPage.html, /FastAPI catalog unavailable/);
assert.doesNotMatch(pricesPage.html, /admin-skeleton/, 'a failed request stops loading');
pricesPage.nodes.find((node) => node.type === AdminStatesMod.ErrorState).props.onRetry();
pricesPage.render();
await pricesPage.settle();
assert.equal(catalogLoads, 2, 'retry calls the API again');
assert.match(pricesPage.html, /Out of stock/);
pricesPage.nodes.find((node) => node.type === 'button' && node.props.children === 'Edit').props.onClick();
pricesPage.render();
assert.equal(pricesPage.nodes.find((node) => node.type === 'input' && node.props.type === 'checkbox').props.checked, true);
pricesPage.nodes.find((node) => node.props['aria-label'] === 'Selling Price for Faki 500g').props.onChange({ target: { value: '550' } });
pricesPage.render();
assert.equal(pricesPage.nodes.find((node) => node.type === 'input' && node.props.type === 'checkbox').props.checked, false, 'changing price withdraws the old approval in the form');
pricesPage.nodes.find((node) => node.type === 'input' && node.props.type === 'checkbox').props.onChange({ target: { checked: true } });
pricesPage.render();
pricesPage.nodes.find((node) => node.type === 'button' && node.props.children === 'Save').props.onClick();
await pricesPage.settle();
assert.deepEqual(JSON.parse(JSON.stringify(savedPrice)), { variants: [{ packSize: '500g', price: 550, priceConfirmed: true }] });
assert.match(pricesPage.html, /₹550/);
assert.match(pricesPage.html, /Approved/);

let stockLoads = 0, stockRequest;
const inventoryItem = { id: 'v1', productId: 'p1', productName: 'Faki', productNameGu: 'ફાકી', packSize: '500g', sku: 'FAKI-500', totalStock: 0, availableStock: 0, reservedStock: 0, lowStockThreshold: 2, isLowStock: true };
const inventoryPage = mountPage('src/features/admin/pages/AdminInventoryPage.tsx', {
  getAdminInventory: async () => ({ summary: { totalStockUnits: 0, availableStockUnits: 0, reservedStockUnits: 0, lowStockAlertsCount: 1, reservationExpiryMinutes: 30 }, items: [{ ...inventoryItem, availableStock: stockLoads++ ? 10 : 0 }], movements: [] }),
  createStockAdjustment: async (payload) => { stockRequest = payload; },
});
await inventoryPage.settle();
inventoryPage.nodes.find((node) => node.type === 'button' && node.props.children === 'Adjust Stock').props.onClick();
inventoryPage.render();
inventoryPage.nodes.find((node) => node.props.id === 'adj-reason').props.onChange({ target: { value: 'Fresh batch' } });
inventoryPage.render();
await inventoryPage.nodes.find((node) => node.type === 'form').props.onSubmit({ preventDefault() {} });
inventoryPage.render();
assert.equal(stockRequest.adjustmentType, 'ADD');
assert.equal(stockRequest.quantity, 10);
assert.equal(stockLoads, 2, 'stock and movement history reload after a successful adjustment');
assert.match(inventoryPage.html, /<strong>10<\/strong>/);

let inventoryReads = 0, stockWrites = 0;
const inventoryAfterSavedError = mountPage('src/features/admin/pages/AdminInventoryPage.tsx', {
  getAdminInventory: async () => {
    if (++inventoryReads === 2) throw new apiModule.ApiError(503, 'Inventory read unavailable');
    return { summary: {}, items: [inventoryItem], movements: [] };
  },
  createStockAdjustment: async () => { stockWrites++; },
});
await inventoryAfterSavedError.settle();
inventoryAfterSavedError.nodes.find((node) => node.type === 'button' && node.props.children === 'Adjust Stock').props.onClick();
inventoryAfterSavedError.render();
inventoryAfterSavedError.nodes.find((node) => node.props.id === 'adj-reason').props.onChange({ target: { value: 'Fresh batch' } });
inventoryAfterSavedError.render();
await inventoryAfterSavedError.nodes.find((node) => node.type === 'form').props.onSubmit({ preventDefault() {} });
inventoryAfterSavedError.render();
assert.match(inventoryAfterSavedError.html, /Stock was saved, but updated inventory could not be loaded/);
assert.equal(inventoryAfterSavedError.nodes.find((node) => node.type === DetailDrawerMod.default).props.open, false, 'successful mutation closes the adjustment form even if its refresh fails');
inventoryAfterSavedError.nodes.find((node) => node.type === AdminStatesMod.ErrorState).props.onRetry();
inventoryAfterSavedError.render();
await inventoryAfterSavedError.settle();
assert.equal(stockWrites, 1, 'retry after a refresh failure must not add the same stock twice');
assert.equal(inventoryReads, 3);

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
assert.match(ordersHtml, /No sample orders are shown/);
assert.match(ordersHtml, /No orders match the current search and status filters/);
assert.doesNotMatch(ordersHtml, /#BFP-/);

const feedbackHtml = renderToStaticMarkup(
  React.createElement(MemoryRouter, { initialEntries: ['/admin/feedback'] }, React.createElement(FeedbackPage)),
);
assert.match(feedbackHtml, /Feedback Management/);
assert.match(feedbackHtml, /Star Rating/);
assert.match(feedbackHtml, /Review data unavailable/);
assert.match(feedbackHtml, /No feedback entries match these filters/);
assert.doesNotMatch(feedbackHtml, /View \/ Reply/);

const paymentsHtml = renderToStaticMarkup(
  React.createElement(MemoryRouter, { initialEntries: ['/admin/payments'] }, React.createElement(PaymentsPage)),
);
assert.match(paymentsHtml, /Payment data unavailable/);
assert.match(paymentsHtml, /No sample payments are shown/);
assert.match(paymentsHtml, /No payment submissions match these filters/);

const deliveryHtml = renderToStaticMarkup(
  React.createElement(MemoryRouter, { initialEntries: ['/admin/delivery'] }, React.createElement(DeliveryPage)),
);
assert.match(deliveryHtml, /Fulfillment data unavailable/);
assert.match(deliveryHtml, /No sample delivery records are shown/);
assert.match(deliveryHtml, /No fulfillment records match these filters/);

const inventoryHtml = renderToStaticMarkup(
  React.createElement(MemoryRouter, { initialEntries: ['/admin/inventory'] }, React.createElement(InventoryPage)),
);
assert.match(inventoryHtml, /Inventory data unavailable/);
assert.match(inventoryHtml, /No sample inventory or movements are shown/);
assert.match(inventoryHtml, /No inventory variants match the current filters/);
assert.match(inventoryHtml, /No stock movements were returned by the inventory API/);

const refundsHtml = renderToStaticMarkup(
  React.createElement(MemoryRouter, { initialEntries: ['/admin/refunds'] }, React.createElement(RefundsPage)),
);
assert.match(refundsHtml, /Refund data unavailable/);
assert.match(refundsHtml, /No sample refund records are shown/);
assert.match(refundsHtml, /No cancellation or refund records match these filters/);

console.log(
  'Admin panel & Neon DB: 18 tables, RLS policies, RBAC route guard, 4-page navigation, minimal Dashboard (Products Sold + Net Profit + Pending Payment Confirmations), Price Management, Order Management, Feedback Management, and typed API client passed.',
);


