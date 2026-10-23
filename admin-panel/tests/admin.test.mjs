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
  '../../../lib/auth': authStub,
  '../../../lib/env': { env },
}, { fetch: (...args) => fakeFetch(...args) });
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

fakeFetch = async (url, options) => {
  capturedRequest = { url, options };
  return url.endsWith('/receipts')
    ? new Response('archive bytes', { status: 200, headers: { 'Content-Type': 'application/zip' } })
    : new Response('receipt bytes', { status: 200, headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="owner-report.pdf"' } });
};
const receipt = await adminApi.getAdminPaymentReceipt('pay/101');
assert.equal(await receipt.blob.text(), 'receipt bytes');
assert.equal(receipt.filename, 'owner-report.pdf');
assert.equal(capturedRequest.url, 'https://api.balajifaki.test/api/admin/payments/pay%2F101/receipt');
assert.equal(capturedRequest.options.headers.get('Authorization'), 'Bearer owner-admin-jwt-token');
assert.ok(capturedRequest.options.signal, 'receipt downloads have a timeout');
await adminApi.getAdminPaymentReceipts(['pay-101', 'pay-102']);
assert.equal(capturedRequest.url, 'https://api.balajifaki.test/api/admin/payments/receipts');
assert.equal(capturedRequest.options.method, 'POST');
assert.deepEqual(JSON.parse(capturedRequest.options.body), { paymentIds: ['pay-101', 'pay-102'] });
assert.equal(capturedRequest.options.headers.get('Content-Type'), 'application/json');
fakeFetch = async (url, options) => { capturedRequest = { url, options }; return new Response(JSON.stringify({ complete: true }), { status: 200 }); };
assert.deepEqual(await adminApi.archiveDeliveredPaymentProof('pay-101'), { complete: true });
assert.equal(capturedRequest.options.method, 'POST');
fakeFetch = async () => new Response(JSON.stringify({ detail: 'Receipt unavailable' }), { status: 404 });
await assert.rejects(adminApi.getAdminPaymentReceipt('missing'), /Receipt unavailable/);
fakeFetch = async (url, options) => {
  capturedRequest = { url, options };
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
};

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
/*  9. PRIMARY ADMIN NAVIGATION & SSR RENDERING VERIFICATION          */
/* ================================================================== */

const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { MemoryRouter } = require('react-router-dom');

const NoticeMod = load('src/components/common/Notice.tsx');
const StatCardMod = load('src/features/admin/components/StatCard.tsx');
const StatusBadgeMod = load('src/features/admin/components/StatusBadge.tsx', {
  '../lib/orderStateMachine': stateMachine,
});
const modalMod = load('src/features/admin/lib/useModalDialog.ts');
const DetailDrawerMod = load('src/features/admin/components/DetailDrawer.tsx', { '../lib/useModalDialog': modalMod });
const ConfirmDialogMod = load('src/features/admin/components/ConfirmDialog.tsx', { '../lib/useModalDialog': modalMod });
const ImagePreviewMod = load('src/features/admin/components/ImagePreview.tsx', { '../lib/useModalDialog': modalMod });
const formatMod = load('src/features/admin/lib/formatDateTime.ts');
const AdminTimelineMod = load('src/features/admin/components/AdminTimeline.tsx', {
  '../lib/formatDateTime': formatMod,
});
const DuplicateNoticeMod = load('src/features/admin/components/DuplicateScreenshotNotice.tsx', {
  '../../../components/common/Notice': NoticeMod,
  '../lib/formatDateTime': formatMod,
  '../lib/orderStateMachine': stateMachine,
});
const AdminStatesMod = load('src/features/admin/components/AdminStates.tsx', {
  '../../../components/common/Notice': NoticeMod,
});
const AdminToastMod = load('src/features/admin/components/Toast.tsx');
const AdminSidebarMod = load('src/features/admin/components/AdminSidebar.tsx', {
  '../../../lib/auth': authStub,
  './StoreLink': { default: () => null },
});

// Settings must be reachable alongside the core management pages.
const navItems = AdminSidebarMod.ADMIN_NAV_GROUPS.flatMap((g) => g.items);
assert.deepEqual(
  JSON.parse(JSON.stringify(navItems.map((i) => ({ label: i.label, to: i.to })))),
  [
    { label: 'Dashboard', to: '/admin/dashboard' },
    { label: 'Price Management', to: '/admin/prices' },
    { label: 'Order Management', to: '/admin/orders' },
    { label: 'Feedback Management', to: '/admin/feedback' },
    { label: 'Settings', to: '/admin/settings' },
  ],
);
for (const open of [false, true]) {
  const sidebarHtml = renderToStaticMarkup(React.createElement(MemoryRouter, { initialEntries: ['/admin/settings'] },
    React.createElement(AdminSidebarMod.default, { open, onClose: () => {} })));
  assert.match(sidebarHtml, /<a\b(?=[^>]*href="\/admin\/settings")(?=[^>]*aria-current="page")[^>]*>[\s\S]*?Settings<\/span>/,
    'Settings is reachable and active in both desktop and expanded mobile navigation');
}

/* T-A10 (D-03): five primary links unchanged + a separate Operations group of existing pages. */
{
  const clean = (items) => JSON.parse(JSON.stringify(items.map((i) => ({ label: i.label, to: i.to }))));
  assert.equal(AdminSidebarMod.ADMIN_NAV_GROUPS.length, 1, 'the primary group is untouched');
  const ops = AdminSidebarMod.ADMIN_OPERATIONS_GROUP;
  assert.equal(ops.section, 'Operations');
  assert.deepEqual(clean(ops.items), [
    { label: 'Payments', to: '/admin/payments' },
    { label: 'Inventory', to: '/admin/inventory' },
    { label: 'Delivery', to: '/admin/delivery' },
    { label: 'Customers', to: '/admin/customers' },
    { label: 'Refunds', to: '/admin/refunds' },
  ]);
  for (const item of ops.items) assert.ok(!navItems.some((p) => p.to === item.to), `${item.to} is not duplicated in the primary links`);
  for (const route of ops.items.map((i) => i.to)) assert.match(appSource, new RegExp(`path="${route.replace('/admin/', '')}"`), `${route} is a real route`);
  for (const open of [false, true]) {
    const html = renderToStaticMarkup(React.createElement(MemoryRouter, { initialEntries: ['/admin/refunds'] },
      React.createElement(AdminSidebarMod.default, { open, onClose: () => {} })));
    const hrefs = [...html.matchAll(/<a\b[^>]*>/g)].map((m) => m[0]).filter((tag) => /class=\"admin-sidebar__link/.test(tag)).map((tag) => /href=\"([^\"]+)\"/.exec(tag)[1]);
    assert.deepEqual(hrefs, ['/admin/dashboard', '/admin/prices', '/admin/orders', '/admin/feedback', '/admin/settings', '/admin/payments', '/admin/inventory', '/admin/delivery', '/admin/customers', '/admin/refunds'], `open=${open}: primary links first, then Operations`);
    assert.doesNotMatch(html, /\/admin\/(reports|notifications)/, 'unfinished pages are not linked');
    const groups = [...html.matchAll(/role="group" aria-labelledby="([^"]+)"/g)].map((m) => m[1]);
    assert.equal(groups.length, 2);
    assert.equal(new Set(groups).size, 2, 'each group has its own label id');
    for (const id of groups) assert.match(html, new RegExp(`id="${id}"[^>]*>`), 'group label exists');
    assert.match(html, /id="admin-nav-operations"[^>]*>Operations</);
    assert.match(html, /<a\b(?=[^>]*href="\/admin\/refunds")(?=[^>]*aria-current="page")/, 'the active Operations page is highlighted');
    assert.doesNotMatch(html, /<a\b(?=[^>]*href="\/admin\/payments")(?=[^>]*aria-current="page")/);
    assert.match(html, /admin-sidebar__group admin-sidebar__group--compact/);
  }
}

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
  '../lib/formatDateTime': formatMod,
  '../components/DuplicateScreenshotNotice': DuplicateNoticeMod,
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
function mountPage(path, apiOverrides, route = {}) {
  const values = [], dependencies = [], effects = [];
  let stateIndex = 0, effectIndex = 0, tree;
  const hooks = {
    ...React,
    useState(initial) {
      const index = stateIndex++;
      if (!(index in values)) values[index] = typeof initial === 'function' ? initial() : initial;
      return [values[index], (next) => { values[index] = typeof next === 'function' ? next(values[index]) : next; }];
    },
    useCallback(callback, deps) {
      const index = stateIndex++;
      if (!values[index] || deps.some((value, i) => value !== values[index].deps[i])) values[index] = { callback, deps };
      return values[index].callback;
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
    'react-router-dom': {
      ...require('react-router-dom'),
      useSearchParams: () => [new URLSearchParams(route.search ?? '')],
      useLocation: () => ({ key: route.key ?? 'initial', state: route.state ?? null }),
      useNavigationType: () => route.navType ?? 'POP',
    },
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

// QR uploads save immediately without discarding unsaved payment/delivery fields.
let settingsWrites = 0, settingsConfirmations = 0;
let storedSettings = { ...baseSettings, officialUpiId: '', officialPayeeName: '', paymentIsLocalTest: false };
const settingsPage = mountPage('src/features/admin/pages/AdminSettingsPage.tsx', {
  getAdminSettings: async () => storedSettings,
  uploadPaymentQr: async () => (storedSettings = { ...storedSettings, officialUpiQrImageUrl: '/api/admin/settings/qr?signed=test' }),
  updateAdminSettings: async (patch) => { settingsWrites++; return (storedSettings = { ...storedSettings, ...patch }); },
  confirmBusinessSettings: async () => {
    settingsConfirmations++;
    if (!storedSettings.officialUpiId || !storedSettings.officialPayeeName) throw new apiModule.ApiError(422, 'Enter the real UPI ID and payee name.');
    return (storedSettings = { ...storedSettings, businessSettingsConfirmedAt: '2026-10-21T07:00:00Z' });
  },
});
await settingsPage.settle();
const settingsField = (id) => settingsPage.nodes.find((node) => node.props.id === id);
const confirmSettingsButton = () => settingsPage.nodes.find((node) => node.type === 'button' && node.props.children === 'Confirm payment, delivery & PIN settings');
await confirmSettingsButton().props.onClick();
await settingsPage.settle();
assert.match(settingsPage.html, /Enter the real UPI ID and payee name/, 'confirmation shows the server validation reason');
await settingsPage.nodes.find((node) => node.type === 'form').props.onSubmit({ preventDefault() {} });
settingsPage.render();
assert.doesNotMatch(settingsPage.html, /Not saved|Nothing has changed|Enter the real UPI ID and payee name/, 'an unchanged Save clears stale errors without reporting failure');
assert.equal(settingsWrites, 0);
for (const [id, value] of [['set-upi', 'shop@examplebank'], ['set-payee', 'Shop Name'], ['set-pins', '']]) {
  settingsField(id).props.onChange({ target: { value } });
  settingsPage.render();
}
await settingsField('set-qr').props.onChange({ target: { files: [{ type: 'image/png' }], value: 'qr.png' } });
await settingsPage.settle();
assert.match(settingsPage.html, /Current payment QR/);
assert.equal(settingsField('set-upi').props.value, 'shop@examplebank', 'upload retains unsaved UPI ID');
assert.equal(settingsField('set-payee').props.value, 'Shop Name', 'upload retains unsaved payee');
assert.equal(settingsField('set-pins').props.value, '', 'upload retains nationwide delivery selection');
await confirmSettingsButton().props.onClick();
await settingsPage.settle();
assert.equal(settingsConfirmations, 1, 'unsaved changes must not confirm older database values');
assert.match(settingsPage.html, /Save your changes before confirming/);
await settingsPage.nodes.find((node) => node.type === 'form').props.onSubmit({ preventDefault() {} });
settingsPage.render();
assert.equal(settingsWrites, 1);
assert.equal(storedSettings.officialUpiId, 'shop@examplebank');
assert.deepEqual(JSON.parse(JSON.stringify(storedSettings.serviceablePinCodes)), []);
await confirmSettingsButton().props.onClick();
await settingsPage.settle();
assert.equal(settingsConfirmations, 2);
assert.match(settingsPage.html, /You confirmed these payment/);
await settingsPage.nodes.find((node) => node.type === 'form').props.onSubmit({ preventDefault() {} });
settingsPage.render();
assert.doesNotMatch(settingsPage.html, /Not saved|Nothing has changed/);
assert.equal(settingsWrites, 1, 'repeated Save does not resend saved settings');

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

/* Orders page regression tests. Every scenario mounts its own page, so none depends on another. */
const baseOrder = {
  id: 'o1', orderNumber: '#BFP-1001', customerName: 'Test Customer', phone: '9800000001', area: 'Rajkot', pinCode: '360001',
  items: [], itemsSummary: 'Faki 500g', totalAmount: 100, orderStatus: 'OUT_FOR_DELIVERY', paymentStatus: 'VERIFIED',
  createdAt: '2026-10-21T10:00:00Z', paymentDetails: { status: 'VERIFIED' }, timeline: [],
};
const cancelledOrder = { ...baseOrder, id: 'o2', orderNumber: '#BFP-2002', orderStatus: 'CANCELLED' };

function mountOrders(route = {}, { orders = [baseOrder, cancelledOrder], api = {} } = {}) {
  const calls = [];
  const writes = [];
  const r = { search: '', key: 'k0', navType: 'POP', state: null, ...route };
  const page = mountPage('src/features/admin/pages/AdminOrdersPage.tsx', {
    getAdminOrders: async (params) => { calls.push(params); return { items: orders }; },
    updateAdminOrderStatus: async (_id, body) => { writes.push(body); return { ...baseOrder, orderStatus: 'DELIVERY_FAILED' }; },
    ...api,
  }, r);
  const flush = async () => { for (let i = 0; i < 4; i += 1) await page.settle(); };
  const node = (id) => page.nodes.find((n) => n.props.id === id);
  return {
    page, calls, writes, flush, node,
    val: (id) => node(id).props.value,
    html: () => page.html,
    go: async (next) => { Object.assign(r, { state: null }, next); page.render(); await flush(); },
    set: async (id, value) => { node(id).props.onChange({ target: { value } }); page.render(); await flush(); },
    confirm: () => page.nodes.find((n) => n.type === ConfirmDialogMod.default),
    button: (label) => page.nodes.find((n) => n.type === 'button' && n.props.children === label),
  };
}
// A search submitted from the global header (AdminHeader passes state.headerSearch) is a PUSH navigation.
const headerNav = (q, key) => ({ search: `q=${encodeURIComponent(q)}`, key, navType: 'PUSH', state: { headerSearch: true } });
const dirtyFilters = async (t) => {
  await t.set('order-status-filter', 'CANCELLED');
  await t.set('payment-status-filter', 'VERIFIED');
  await t.set('order-date-from', '2026-10-01');
  await t.set('order-date-to', '2026-10-31');
};

{ /* F-1 (1): header search with Order Status = Cancelled shows the match instead of an empty table */
  const t = mountOrders(); await t.flush();
  assert.equal(t.calls.length, 1, 'initial load = one request');
  await t.set('order-status-filter', 'CANCELLED');
  assert.doesNotMatch(t.html(), /#BFP-1001/, 'precondition: the Cancelled filter hides the out-for-delivery order');
  const before = t.calls.length;
  await t.go(headerNav('BFP-1001', 'k1'));
  assert.equal(t.val('order-search'), 'BFP-1001');
  assert.equal(t.val('order-status-filter'), 'ALL');
  assert.equal(t.calls.length, before + 1, 'exactly one refresh request');
  assert.equal(t.calls.at(-1).status, 'ALL');
  assert.equal(t.calls.at(-1).search, 'BFP-1001');
  assert.match(t.html(), /#BFP-1001/);
}

{ /* F-1 (2): payment and date filters are reset as well */
  const t = mountOrders(); await t.flush();
  await dirtyFilters(t);
  assert.equal(t.val('order-date-from'), '2026-10-01');
  const before = t.calls.length;
  await t.go(headerNav('BFP-1001', 'k1'));
  for (const id of ['order-date-from', 'order-date-to']) assert.equal(t.val(id), '', `${id} cleared`);
  assert.equal(t.val('order-status-filter'), 'ALL');
  assert.equal(t.val('payment-status-filter'), 'ALL');
  assert.equal(t.calls.length, before + 1, 'four filter resets + new query = one request');
  const last = t.calls.at(-1);
  assert.deepEqual([last.status, last.paymentStatus, last.dateFrom, last.dateTo, last.search], ['ALL', 'ALL', undefined, undefined, 'BFP-1001']);
}

for (const navType of ['PUSH', 'REPLACE']) { /* F-2 (3): clicking the active Order Management link keeps the working state */
  const t = mountOrders(); await t.flush();
  await t.go(headerNav('BFP-1001', 'k1'));
  await dirtyFilters(t);
  await t.set('order-search', 'typed by hand');
  const before = t.calls.length;
  await t.go({ search: '', key: 'k2', navType });
  assert.equal(t.val('order-search'), 'typed by hand', `${navType}: search kept`);
  assert.equal(t.val('order-status-filter'), 'CANCELLED');
  assert.equal(t.val('payment-status-filter'), 'VERIFIED');
  assert.equal(t.val('order-date-from'), '2026-10-01');
  assert.equal(t.val('order-date-to'), '2026-10-31');
  assert.equal(t.calls.length, before, `${navType}: no request, no reload`);
}

{ /* F-2 (3b): a plain link with ?q= (no header flag) applies the query but does not touch the filters */
  const t = mountOrders(); await t.flush();
  await t.set('order-status-filter', 'CANCELLED');
  await t.go({ search: 'q=BFP-2002', key: 'k1', navType: 'PUSH' });
  assert.equal(t.val('order-search'), 'BFP-2002');
  assert.equal(t.val('order-status-filter'), 'CANCELLED');
}

{ /* (4) arriving from another page: normal unfiltered list, or the link's own query; header from another page = one request */
  const plain = mountOrders({ navType: 'PUSH' }); await plain.flush();
  assert.equal(plain.val('order-search'), '');
  for (const id of ['order-status-filter', 'payment-status-filter']) assert.equal(plain.val(id), 'ALL');
  assert.equal(plain.calls.length, 1);
  assert.equal(plain.calls[0].search, undefined);
  assert.match(plain.html(), /#BFP-1001/);
  assert.match(plain.html(), /#BFP-2002/);

  const fromCustomers = mountOrders({ search: 'q=%23BFP-1001', navType: 'PUSH' }); await fromCustomers.flush();
  assert.equal(fromCustomers.val('order-search'), '#BFP-1001');
  assert.equal(fromCustomers.val('order-status-filter'), 'ALL');
  assert.equal(fromCustomers.calls.length, 1);

  const fromHeader = mountOrders(headerNav('BFP-1001', 'k0')); await fromHeader.flush();
  assert.equal(fromHeader.val('order-search'), 'BFP-1001');
  assert.equal(fromHeader.calls.length, 1, 'header search from another page does not issue a duplicate request');
}

{ /* (5) Back / Forward restore the query; history entries keep the header flag but POP must not reset filters */
  const t = mountOrders(); await t.flush();
  await t.go(headerNav('BFP-1001', 'k1'));
  await t.go(headerNav('BFP-2002', 'k2'));
  await t.set('order-status-filter', 'CANCELLED');
  const before = t.calls.length;
  await t.go({ search: 'q=BFP-1001', key: 'k1', navType: 'POP', state: { headerSearch: true } });
  assert.equal(t.val('order-search'), 'BFP-1001', 'Back restores the earlier query');
  assert.equal(t.val('order-status-filter'), 'CANCELLED', 'Back does not reset filters');
  assert.equal(t.calls.length, before + 1);
  await t.go({ search: 'q=BFP-2002', key: 'k2', navType: 'POP', state: { headerSearch: true } });
  assert.equal(t.val('order-search'), 'BFP-2002', 'Forward restores the later query');
  assert.equal(t.val('order-status-filter'), 'CANCELLED');
  await t.go({ search: '', key: 'k0', navType: 'POP' });
  assert.equal(t.val('order-search'), '', 'Back to an entry without a query clears the search text');
  const settled = t.calls.length;
  await t.go({ search: '', key: 'k0b', navType: 'POP' });
  assert.equal(t.calls.length, settled, 'no request when the restored query is unchanged');
}

{ /* (6) empty ?q= and ?orderId= fallback (current precedence: q, then orderId; an empty q still wins) */
  for (const [search, expected] of [['q=', ''], ['orderId=BFP-1001', 'BFP-1001'], ['q=BFP-2002&orderId=BFP-1001', 'BFP-2002'], ['q=&orderId=BFP-1001', '']]) {
    const t = mountOrders({ search }); await t.flush();
    assert.equal(t.val('order-search'), expected, search);
    assert.equal(t.calls[0].search, expected || undefined, search);
  }
  const t = mountOrders({ search: 'q=' }); await t.flush();
  assert.match(t.html(), /#BFP-1001/);
  assert.match(t.html(), /#BFP-2002/);
}

{ /* (7) repeated identical header searches: one request and a full filter reset every time */
  const t = mountOrders(); await t.flush();
  await t.go(headerNav('BFP-1001', 'k1'));
  for (let i = 2; i <= 4; i += 1) {
    if (i < 4) await t.set('order-status-filter', 'CANCELLED');
    const before = t.calls.length;
    await t.go(headerNav('BFP-1001', `k${i}`));
    assert.equal(t.calls.length, before + 1, `repeat ${i}: exactly one request`);
    assert.equal(t.val('order-status-filter'), 'ALL', `repeat ${i}: filters reset`);
    assert.equal(t.val('order-search'), 'BFP-1001');
  }
}

{ /* (8) typing in the Orders box never resets filters; one request per change, as before */
  const t = mountOrders(); await t.flush();
  await dirtyFilters(t);
  const before = t.calls.length;
  await t.set('order-search', 'abc');
  await t.set('order-search', 'abcd');
  assert.equal(t.val('order-status-filter'), 'CANCELLED');
  assert.equal(t.val('payment-status-filter'), 'VERIFIED');
  assert.equal(t.val('order-date-from'), '2026-10-01');
  assert.equal(t.calls.length, before + 2);
}

/* T-A7 (independent): Record Delivery Failure on Orders */
for (const status of ['PICKED_UP', 'SHIPPED', 'OUT_FOR_DELIVERY']) {
  const failure = getAllowedOrderActions(status, 'VERIFIED').find((a) => a.nextStatus === 'DELIVERY_FAILED');
  assert.equal(failure?.label, 'Record Delivery Failure');
  assert.equal(failure.tone, 'danger');
}
for (const status of ['PENDING_PAYMENT', 'AWAITING_CONFIRMATION', 'CONFIRMED', 'PACKING', 'PACKED', 'DELIVERED', 'CANCELLED', 'DELIVERY_FAILED']) {
  assert.ok(!getAllowedOrderActions(status, 'VERIFIED').some((a) => a.nextStatus === 'DELIVERY_FAILED'), `${status} must not offer delivery failure`);
}
assert.deepEqual(JSON.parse(JSON.stringify(getAllowedOrderActions('DELIVERY_FAILED', 'VERIFIED').map((a) => a.nextStatus))), ['OUT_FOR_DELIVERY', 'CANCELLED']);

{ /* valid and invalid reasons, danger confirmation */
  const t = mountOrders({ search: 'q=BFP-1001' }); await t.flush();
  t.button('Record Delivery Failure').props.onClick(); t.page.render();
  assert.equal(t.confirm().props.open, true);
  assert.equal(t.confirm().props.tone, 'danger', 'delivery failure confirmation uses the danger style');
  assert.match(t.html(), /Delivery Failure Reason \(Required\)/);
  await t.set('order-action-notes', 'abc');
  await t.confirm().props.onConfirm();
  assert.equal(t.writes.length, 0, 'a reason shorter than 5 characters is not sent');
  assert.equal(t.confirm().props.open, true);
  await t.set('order-action-notes', 'Customer unreachable');
  await t.confirm().props.onConfirm(); t.page.render();
  assert.equal(t.writes.length, 1);
  assert.equal(t.writes[0].status, 'DELIVERY_FAILED');
  assert.equal(t.writes[0].failureReason, 'Customer unreachable');
  assert.equal(t.writes[0].cancellationReason, undefined);
  assert.equal(t.confirm().props.open, false, 'dialog closes after success');
}

{ /* other actions keep the primary style; a server rejection keeps the dialog open */
  const t = mountOrders({ search: 'q=BFP-1001' }, { api: { updateAdminOrderStatus: async () => { throw new Error('Invalid transition'); } } }); await t.flush();
  t.button('Mark Delivered').props.onClick(); t.page.render();
  assert.equal(t.confirm().props.tone, 'primary');
  t.confirm().props.onCancel(); t.page.render();
  t.button('Record Delivery Failure').props.onClick(); t.page.render();
  await t.set('order-action-notes', 'Customer unreachable');
  await t.confirm().props.onConfirm(); t.page.render();
  assert.equal(t.confirm().props.open, true, 'a rejected request keeps the dialog open for retry');
}

{ /* the drawer footer offers the same action */
  const t = mountOrders({ search: 'q=BFP-1001' }); await t.flush();
  t.button('View Order').props.onClick(); t.page.render();
  const drawer = t.page.nodes.find((n) => n.type === DetailDrawerMod.default);
  assert.equal(drawer.props.open, true);
  assert.match(renderToStaticMarkup(React.createElement(MemoryRouter, null, drawer.props.footer)), /Record Delivery Failure/);
}

/* T-A2: one readable timestamp convention ("21 Oct 2026, 6:34 pm IST", Asia/Kolkata); API values unchanged. */
{
  const { formatDateTime, formatDate } = formatMod;
  const cases = [
    ['2026-10-21T13:04:00+00:00', '21 Oct 2026, 6:34 pm IST'], // backend _iso() output
    ['2026-10-21T13:04:00Z', '21 Oct 2026, 6:34 pm IST'],
    ['2026-10-21T18:34:00+05:30', '21 Oct 2026, 6:34 pm IST'], // explicit offset
    ['2026-10-21T13:04:00.123456+00:00', '21 Oct 2026, 6:34 pm IST'], // microseconds
    ['2026-10-21T13:04:00', '21 Oct 2026, 6:34 pm IST'], // no zone = UTC
    ['2026-10-21 13:04:00', '21 Oct 2026, 6:34 pm IST'],
    ['2026-10-21T18:30:00Z', '22 Oct 2026, 12:00 am IST'], // IST midnight crosses the UTC date
    ['2026-10-21T18:29:00Z', '21 Oct 2026, 11:59 pm IST'],
    ['2026-10-21T06:30:00Z', '21 Oct 2026, 12:00 pm IST'],
    ['2026-10-05T03:35:00Z', '5 Oct 2026, 9:05 am IST'], // no zero-padding on day or hour
    ['2026-12-31T20:00:00Z', '1 Jan 2027, 1:30 am IST'], // year rollover
    ['2026-10-19', '19 Oct 2026'], // bare date: shown as that calendar date, never shifted
  ];
  for (const [input, expected] of cases) assert.equal(formatDateTime(input), expected, input);
  assert.equal(formatDateTime(new Date('2026-10-21T13:04:00Z')), '21 Oct 2026, 6:34 pm IST');
  for (const bad of [null, undefined, '', '   ', 'not a date', '2026-13-45', '2026-02-31x']) {
    assert.equal(formatDateTime(bad), '—', `formatDateTime(${JSON.stringify(bad)})`);
    assert.equal(formatDate(bad), '—');
  }
  assert.equal(formatDateTime('2026-13-45'), '—');
  assert.equal(formatDate('2026-10-21T20:00:00Z'), '22 Oct 2026', 'formatDate uses the IST calendar day');
  assert.equal(formatDate('2026-10-19'), '19 Oct 2026');
  assert.equal(formatDate('2026-10-21T13:04:00+00:00'), '21 Oct 2026');

  const timelineHtml = renderToStaticMarkup(React.createElement(AdminTimelineMod.default, {
    items: [{ id: 't1', label: 'Payment approved', timestamp: '2026-10-21T13:04:00+00:00', description: 'ok', actor: 'Owner' }],
  }));
  assert.match(timelineHtml, /21 Oct 2026, 6:34 pm IST · Actor: Owner/);
  assert.doesNotMatch(timelineHtml, /13:04:00|\+00:00/);

  const orderWithTimeline = { ...baseOrder, createdAt: '2026-10-21T13:04:00+00:00', timeline: [{ id: 'e1', label: 'Placed', timestamp: '2026-10-21T13:04:00+00:00', description: 'x', actorName: 'Cust', actorRole: 'CUSTOMER' }] };
  const ordersT = mountOrders({ search: 'q=BFP-1001' }, { orders: [orderWithTimeline] }); await ordersT.flush();
  assert.match(ordersT.html(), /21 Oct 2026, 6:34 pm IST/, 'Orders table shows the convention');
  assert.doesNotMatch(ordersT.html(), /13:04:00|T13:04|\+00:00/, 'no raw ISO text in the Orders table');
  ordersT.button('View Order').props.onClick(); ordersT.page.render();
  const drawerHtml = ordersT.html();
  assert.match(drawerHtml, /Placed on 21 Oct 2026, 6:34 pm IST/, 'drawer subtitle');
  assert.doesNotMatch(drawerHtml, /13:04:00|\+00:00/, 'no raw ISO text in the Orders drawer or its timeline');

  const stockItem = { id: 'v1', productId: 'p1', productName: 'Faki', productNameGu: 'ફાકી', packSize: '500g', sku: 'F', totalStock: 5, availableStock: 5, reservedStock: 0, lowStockThreshold: 2, isLowStock: false };
  const inventoryT = mountPage('src/features/admin/pages/AdminInventoryPage.tsx', {
    getAdminInventory: async () => ({
      summary: { totalStockUnits: 5, availableStockUnits: 5, reservedStockUnits: 0, lowStockAlertsCount: 0, reservationExpiryMinutes: 30 },
      items: [stockItem],
      movements: [{ id: 'm1', createdAt: '2026-10-21T13:04:00+00:00', productName: 'Faki', packSize: '500g', movementType: 'MANUAL_ADD', quantityDelta: 5, previousAvailable: 0, newAvailable: 5, reason: 'Fresh batch', actorEmail: 'a@b.c' }],
    }),
  });
  await inventoryT.settle(); await inventoryT.settle();
  assert.match(inventoryT.html, /21 Oct 2026, 6:34 pm IST/, 'Inventory movement time');
  assert.doesNotMatch(inventoryT.html, /T13:04|\+00:00/);

  // Guard: the pages that show server times must go through the formatter (no raw fields, no ad-hoc toLocale*).
  const rawPatterns = [
    /\{\s*(mov|rev|payment|selectedPayment)\.(createdAt|submissionDate)\s*\}/, /\{\s*item\.cancelledAt\s*\}/, /\{\s*selectedRefund\.refundDate\s*\}/,
    /\$\{selectedRefund\.cancelledAt\}/, /\$\{selectedReview\.createdAt\}/, /new Date\([^)]*\)\.toLocale/,
  ];
  for (const page of ['Orders', 'Dashboard', 'Customers', 'Inventory', 'Payments', 'Refunds', 'Reviews', 'Delivery']) {
    const source = readFileSync(new URL(`../src/features/admin/pages/Admin${page}Page.tsx`, import.meta.url), 'utf8');
    for (const pattern of rawPatterns) assert.doesNotMatch(source, pattern, `Admin${page}Page renders a raw or ad-hoc time (${pattern})`);
  }
  assert.match(readFileSync(new URL('../src/features/admin/components/AdminTimeline.tsx', import.meta.url), 'utf8'), /formatDateTime\(item\.timestamp\)/);
}

/* T-A4: shared dialog behaviour (focus trap, topmost-only Escape) and labelled dialogs. Real focus/Escape/Tab runs in the browser smoke. */
{
  const { nextTabTarget, isTopmostDialog } = modalMod;
  const items = ['a', 'b', 'c'];
  const next = (active, shiftKey, activeInside = true) => nextTabTarget({ items, active, shiftKey, activeInside });
  assert.equal(next('c', false), 'a', 'Tab on the last control wraps to the first');
  assert.equal(next('a', true), 'c', 'Shift+Tab on the first control wraps to the last');
  assert.equal(next('b', false), null, 'Tab in the middle is left to the browser');
  assert.equal(next('b', true), null);
  assert.equal(next('x', false, false), 'a', 'focus outside the dialog is pulled back in (forward)');
  assert.equal(next('x', true, false), 'c', 'focus outside the dialog is pulled back in (backward)');
  assert.equal(nextTabTarget({ items: [], active: null, shiftKey: false, activeInside: false }), null);
  assert.equal(nextTabTarget({ items: ['only'], active: 'only', shiftKey: false, activeInside: true }), 'only', 'a single control keeps focus');

  const drawer = Symbol('drawer'), confirm = Symbol('confirm');
  assert.equal(isTopmostDialog(confirm, [drawer, confirm]), true);
  assert.equal(isTopmostDialog(drawer, [drawer, confirm]), false, 'a dialog under another one ignores Escape/Tab');
  assert.equal(isTopmostDialog(drawer, [drawer]), true);
  assert.equal(isTopmostDialog(drawer, []), false);

  const h = (el) => renderToStaticMarkup(el);
  const nested = h(React.createElement(React.Fragment, null,
    React.createElement(DetailDrawerMod.default, { open: true, title: 'Order A', onClose() {}, children: 'x' }),
    React.createElement(ConfirmDialogMod.default, { open: true, title: 'Confirm B', description: 'd', onConfirm() {}, onCancel() {} })));
  const labels = [...nested.matchAll(/aria-labelledby="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(labels.length, 2);
  assert.notEqual(labels[0], labels[1], 'a drawer and a confirmation open together must not share a title id');
  for (const id of labels) assert.match(nested, new RegExp(`<h2 id="${id}">`), 'every dialog is labelled by its own title');
  assert.equal((nested.match(/role="dialog"/g) || []).length, 2);
  assert.equal((nested.match(/tabindex="-1"/g) || []).length, 2, 'dialogs can receive focus even without a control');

  const preview = h(React.createElement(ImagePreviewMod.default, { src: '/x.png', alt: 'Payment screenshot' }));
  assert.match(preview, /View full image/, 'closed preview shows only its trigger');
  assert.doesNotMatch(preview, /role="dialog"/);

  const dialogSources = ['ConfirmDialog', 'DetailDrawer', 'ImagePreview', 'AdminHeader'].map((n) => readFileSync(new URL(`../src/features/admin/components/${n}.tsx`, import.meta.url), 'utf8'));
  for (const source of dialogSources) assert.match(source, /useModalDialog/, 'every dialog uses the shared hook');
  for (const source of dialogSources.slice(0, 3)) assert.doesNotMatch(source, /addEventListener\('keydown'/, 'no private Escape listeners left');
  assert.match(dialogSources[1], /useModalDialog<HTMLDivElement>\(open, onClose\)/);
  assert.match(dialogSources[0], /useModalDialog<HTMLDivElement>\(open, onCancel, !busy\)/, 'Escape is ignored while a request is running');
  assert.match(dialogSources[3], /data-autofocus/, 'profile dialog starts on the name field');
}

/* T-A3: tables that become cards on phones keep a label on every cell and an Action cell. */
{
  for (const page of ['Orders', 'Delivery']) {
    const source = readFileSync(new URL(`../src/features/admin/pages/Admin${page}Page.tsx`, import.meta.url), 'utf8');
    assert.match(source, /<table className="data-table data-table--cards">/, `${page} table opts into card layout`);
    const row = source.slice(source.indexOf('<tr key={'), source.indexOf('</tr>', source.indexOf('<tr key={')));
    const cells = [...row.matchAll(/<td\b[^>]*>/g)].map((m) => m[0]);
    const headers = [...source.slice(source.indexOf('<thead>'), source.indexOf('</thead>')).matchAll(/<th scope="col">([^<]+)<\/th>/g)].map((m) => m[1].replace('&amp;', '&'));
    assert.equal(cells.length, headers.length, `${page}: one td per th`);
    cells.forEach((cell, i) => {
      assert.ok(cell.includes(`data-label="${headers[i].replace('&', '&amp;')}"`) || cell.includes(`data-label="${headers[i]}"`), `${page}: cell ${i} is labelled "${headers[i]}"`);
    });
    assert.match(cells.at(-1), /data-table__actions/, `${page}: the Action cell is the card footer`);
  }
  const delivery = readFileSync(new URL('../src/features/admin/pages/AdminDeliveryPage.tsx', import.meta.url), 'utf8');
  assert.match(delivery, /className="admin-table-wrap" role="region" aria-label="Fulfillment queue"/, 'Delivery no longer inherits the customers-table column widths that clipped its actions');
}

/* T-B1: duplicate-screenshot warning is information only: neutral wording, same-order vs other-order, capped list. */
{
  const Notice = DuplicateNoticeMod.default;
  const h = (props) => renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(Notice, props)));
  assert.equal(h({ info: undefined }), '');
  assert.equal(h({ info: { count: 0, matches: [] } }), '');

  const other = { paymentId: 'p1', orderNumber: '#BFP-1004', orderStatus: 'CANCELLED', paymentStatus: 'REJECTED', submittedAt: '2026-10-12T09:15:00+00:00', sameOrder: false };
  const same = { paymentId: 'p2', orderNumber: '#BFP-1020', orderStatus: 'PENDING_PAYMENT', paymentStatus: 'REJECTED', submittedAt: '2026-10-21T13:04:00+00:00', sameOrder: true };
  const plain = (s) => s.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const raw = h({ info: { count: 2, matches: [other, same] }, onOpenPayment() {} });
  const html = plain(raw);
  assert.match(html, /Possible duplicate screenshot/);
  assert.match(html, /Also uploaded for another order: #BFP-1004/);
  assert.match(html, /Sent earlier for this same order: #BFP-1020/);
  assert.match(html, /12 Oct 2026, 2:45 pm IST/, 'times use the admin convention');
  assert.match(html, /payment rejected/);
  assert.equal((html.match(/Open payment/g) || []).length, 2, 'each match can be opened');
  assert.equal((html.match(/View order/g) || []).length, 1, 'order link only for the other order');
  assert.ok(html.indexOf('View order') < html.indexOf('Sent earlier'), 'the link belongs to the other-order row');
  assert.match(raw, /href="\/admin\/orders\?q=%23BFP-1004"/);
  assert.match(html, /does not mean this payment is wrong or that anyone did something wrong/);
  assert.match(html, /cropped, edited or re-saved/, 'the limit of an exact-file match is stated');
  assert.doesNotMatch(html, /fraud|fake|forg|cheat|scam|suspicious|reject this|do not approve/i, 'wording stays neutral');
  assert.doesNotMatch(html, /more match/);
  assert.doesNotMatch(h({ info: { count: 1, matches: [other] } }), /Open payment/, 'no button without a handler');

  const capped = plain(h({ info: { count: 13, matches: Array.from({ length: 10 }, (_, i) => ({ ...other, paymentId: `c${i}` })) } }));
  assert.match(capped, /3 more matches not shown/);
  assert.match(plain(h({ info: { count: 11, matches: Array.from({ length: 10 }, (_, i) => ({ ...other, paymentId: `d${i}` })) } })), /1 more match not shown/);

  const payment = (id, number, duplicate) => ({
    id, orderId: `o-${id}`, orderNumber: number, customerName: 'Test Customer', customerPhone: '9800000001', expectedAmount: 100,
    privateScreenshotPath: 'p/x.png', signedScreenshotUrl: '/api/admin/payments/x/proof', submissionDate: '2026-10-21T13:04:00+00:00',
    paymentStatus: 'UNDER_REVIEW', orderStatus: 'PAYMENT_REVIEW', verificationHistory: [],
    ...(duplicate ? { duplicateScreenshot: duplicate } : {}),
  });
  const payments = [payment('pay-a', '#BFP-3001', { count: 1, matches: [other] }), payment('pay-b', '#BFP-3002', { count: 0, matches: [] }), payment('pay-c', '#BFP-3003')];
  const paymentsPage = mountPage('src/features/admin/pages/AdminPaymentsPage.tsx', {
    getAdminPayments: async () => ({ items: payments }),
    getAdminPaymentProof: async () => ({ signedUrl: '/x' }),
  }, { search: 'payment=pay-a' });
  await paymentsPage.settle(); await paymentsPage.settle();
  const rawPage = paymentsPage.html;
  const pageHtml = plain(rawPage);
  assert.equal((rawPage.match(/Open the payment to see where/g) || []).length, 1, 'only the payment with a match gets the list badge');
  assert.match(pageHtml, /Possible duplicate screenshot/);
  assert.match(pageHtml, /#BFP-1004/, 'the drawer for the focused payment lists the match');
  assert.match(pageHtml, /Approve Payment/, 'approval section is unchanged by a match');
  assert.match(pageHtml, /Reject/, 'rejection is unchanged by a match');
  const selectAll = () => paymentsPage.nodes.find((node) => node.type === 'input' && node.props['aria-label'] === 'Select all shown payments');
  selectAll().props.onChange({ target: { checked: true } });
  paymentsPage.render();
  assert.match(paymentsPage.html, /Download selected receipts \(3\)/, 'select all includes all shown payments');
  selectAll().props.onChange({ target: { checked: false } });
  paymentsPage.render();
  assert.match(paymentsPage.html, /Download selected receipts \(0\)/, 'selection can be cleared');

  const failedBulk = mountPage('src/features/admin/pages/AdminPaymentsPage.tsx', {
    getAdminPayments: async () => ({ items: payments }),
    getAdminPaymentReceipts: async () => { throw new apiModule.ApiError(413, 'Choose fewer receipts for this download.'); },
  });
  await failedBulk.settle(); await failedBulk.settle();
  failedBulk.nodes.find((node) => node.type === 'input' && node.props['aria-label'] === 'Select all shown payments').props.onChange({ target: { checked: true } });
  failedBulk.render();
  await failedBulk.nodes.find((node) => node.type === 'button' && typeof node.props.children === 'string' && node.props.children.includes('Download selected receipts')).props.onClick();
  failedBulk.render();
  assert.match(failedBulk.html, /Choose fewer receipts for this download/, 'oversized ZIP failure stays visible');

  let deliveredProofCalls = 0;
  const delivered = mountPage('src/features/admin/pages/AdminPaymentsPage.tsx', {
    getAdminPayments: async () => ({ items: [{ ...payment('pay-delivered', '#BFP-3004'), orderStatus: 'DELIVERED', signedScreenshotUrl: undefined }] }),
    getAdminPaymentProof: async () => { deliveredProofCalls++; return { signedUrl: '/x' }; },
  }, { search: 'payment=pay-delivered' });
  await delivered.settle(); await delivered.settle();
  assert.equal(deliveredProofCalls, 0, 'delivered screenshot is not requested after cleanup');
  assert.match(delivered.html, /Both payment images are kept in the downloadable receipt/);
  assert.match(delivered.html, /Download receipt/);
  assert.match(delivered.html, /Retry screenshot cleanup/);

  const requestedPages = [];
  const paged = mountPage('src/features/admin/pages/AdminPaymentsPage.tsx', {
    getAdminPayments: async ({ page }) => { requestedPages.push(page); return { items: payments, totalPages: 2 }; },
  });
  await paged.settle(); await paged.settle();
  paged.nodes.find((node) => node.type === 'input' && node.props['aria-label'] === 'Select all shown payments').props.onChange({ target: { checked: true } });
  paged.render();
  paged.nodes.find((node) => node.type === 'button' && node.props.children === 'Next page').props.onClick();
  paged.render(); await paged.settle(); await paged.settle();
  assert.deepEqual(requestedPages, [1, 2], 'older payment pages remain reachable for receipt selection');
  assert.match(paged.html, /Download selected receipts \(3\)/, 'selection persists across pages');

  const overLimit = mountPage('src/features/admin/pages/AdminPaymentsPage.tsx', {
    getAdminPayments: async () => ({ items: Array.from({ length: 101 }, (_, index) => payment(`pay-${index}`, `#BFP-${index}`)) }),
  });
  await overLimit.settle(); await overLimit.settle();
  overLimit.nodes.find((node) => node.type === 'input' && node.props['aria-label'] === 'Select all shown payments').props.onChange({ target: { checked: true } });
  overLimit.render();
  assert.match(overLimit.html, /Select at most 100 payments per download/);
  assert.match(overLimit.html, /Download selected receipts \(0\)/);
  const noDuplicate = mountPage('src/features/admin/pages/AdminPaymentsPage.tsx', {
    getAdminPayments: async () => ({ items: payments }),
    getAdminPaymentProof: async () => ({ signedUrl: '/x' }),
  }, { search: 'payment=pay-b' });
  await noDuplicate.settle(); await noDuplicate.settle();
  assert.doesNotMatch(plain(noDuplicate.html), /This exact image file was uploaded before/, 'no notice without a match');
  assert.match(plain(noDuplicate.html), /Approve Payment/);

  const source = readFileSync(new URL('../src/features/admin/pages/AdminPaymentsPage.tsx', import.meta.url), 'utf8');
  const approveBlock = source.slice(source.indexOf('async function handleApprovePayment'), source.indexOf('async function handleRejectOrRequestProof'));
  assert.doesNotMatch(approveBlock, /duplicateScreenshot/, 'approval logic never reads the duplicate information');
}

console.log(
  'Admin panel & Neon DB: 18 tables, RLS policies, RBAC route guard, navigation including Settings, minimal Dashboard (Products Sold + Net Profit + Pending Payment Confirmations), Price Management, Order Management, Feedback Management, and typed API client passed.',
);


