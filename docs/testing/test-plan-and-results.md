# Testing & Validation Guide — Balaji Faki Point

## 1. Automated Test Commands

Run from the workspace root (`D:\D&D Projects\Balaji Faki Website`):

```powershell
# Run TypeScript compiler validation
npm run typecheck

# Run all 4 automated test suites
npm test

# Run individual test suites
node tests/checkout.test.mjs
node tests/secondary-pages.test.mjs
node tests/auth.test.mjs
node tests/admin.test.mjs

# Run production build check
npm run build
```

---

## 2. Test Coverage by Suite

### Suite 1: [`tests/checkout.test.mjs`](../../tests/checkout.test.mjs)
- Order form validation (product, pack size `250g`/`500g`/`1kg`, quantity `1..20`, Indian mobile `+91`, 6-digit PIN code).
- Account-scoped draft persistence (`sessionStorage`) and cross-account isolation.
- Automatic reset of payment state if product, pack size, quantity, or address changes.
- UTR validation (exact 12 digits), screenshot MIME/size validation (`JPEG`/`PNG`/`WEBP`, `<= 5 MB`).
- Server quote & order contract validation (`total === subtotal + deliveryFee`, rejects `javascript:` QR URLs).
- `Authorization: Bearer` header and `Idempotency-Key` header verification.

### Suite 2: [`tests/secondary-pages.test.mjs`](../../tests/secondary-pages.test.mjs)
- Customer search, area filter, and repeat/pending segment filter (`filterCustomers`).
- Spreadsheet-safe CSV export (`customersToCsv` escapes leading `=`, `+`, `-`, `@` and quotes).
- Customer review form validation in English and Gujarati (`validateFeedback`).

### Suite 3: [`tests/auth.test.mjs`](../../tests/auth.test.mjs)
- Entry authentication gate (`AuthGate`) blocking unauthenticated access.
- Profile completion gate (`CompleteProfile`) requiring valid full name and 10-digit Indian mobile number (`6–9`).
- Sign-out locking the store immediately.

### Suite 4: [`tests/admin.test.mjs`](../../tests/admin.test.mjs)
- Role-based access control (`evaluateAdminRouteAccess` blocks `CUSTOMER` and unauthenticated users, allows `OWNER_ADMIN`).
- Strict separation between Payment Approval (`VERIFIED` + `AWAITING_CONFIRMATION`) and Order Confirmation (`CONFIRMED`).
- Blocks confirming an order when payment is unverified or stock is insufficient.
- Blocks packing (`PACKING`) when order is not `CONFIRMED` or payment is not `VERIFIED`.
- Blocks duplicate payment approvals, duplicate UTRs, duplicate bank credit references, and mismatched amounts.
- Prevents skipping fulfillment steps and locks `CANCELLED` orders from further transitions.
- Blocks marking refunds `COMPLETED` without a verified bank transaction reference, bank account, date, and exact amount match.
- Rejects negative available stock adjustments.
- Verifies all 21 tables, RLS enablement and that nothing is granted to public roles in [`backend/migrations/neon/001_schema.sql`](../../backend/migrations/neon/001_schema.sql); the live flow is covered by `scripts/e2e-neon-dev.py` on a Neon branch.

---

## 3. Known Integration Blockers

- **FastAPI Backend Service**: The Python FastAPI backend (`VITE_API_BASE_URL`) is not implemented yet. Until FastAPI is running:
  - Live checkout quote/order creation and screenshot upload to FastAPI are intentionally disabled with clear user-facing notices.
  - Admin Panel modules clearly display an `IntegrationPendingBanner` and block live financial mutations so reference data is never confused with live backend records.
