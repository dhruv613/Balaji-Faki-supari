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
  new URL('../supabase/migrations/20261017000000_balaji_faki_point_schema.sql', import.meta.url),
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

console.log(
  'Admin panel & Supabase DB: 18 tables, RLS policies, RBAC route guard, payment/order state separation, duplicate UTR/bank-ref blocking, step-skip prevention, refund verification, stock bounds, and typed API client passed.',
);

