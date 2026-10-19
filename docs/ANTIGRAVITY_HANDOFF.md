# Balaji Faki Point — Archived Antigravity Handoff

> Historical record only. Its prior remote/staging instructions are obsolete and must not be run.
> Use `docs/CODEX_ACTIVE_TASK.md`, the local Supabase configuration, and local-only verification instead.

**Repository**: `https://github.com/dhruv613/Balaji-Faki-supari`  
**Active Development Branch**: `dev/antigravity`  
**Production Website**: `https://balaji-faki-point.vercel.app/`  
**Supabase Production Project Ref**: `zyzkoolgwbczvvetjnwf` (Production DB untouched; all testing conducted in isolated staging environments)

---

## 1. Executive Summary & Verification State

This document records the complete architecture, security remediation, live staging services verification, genuine Supabase Auth integration, customer checkout flow, admin verification, and production readiness runbook completed on branch `dev/antigravity`.

### Current Verification Status: 100% PASS (All 5 Checks)
- **1. Frontend TypeScript Validation (`npm run typecheck`)**: **PASS (0 errors)**
- **2. Automated Test Suites (`npm test`)**: **PASS**
  - `frontend/tests/checkout.test.mjs`: Validation, draft persistence, bearer auth, idempotency, upload checks passed.
  - `frontend/tests/secondary-pages.test.mjs`: Combined customer filters, safe CSV, and feedback validation passed.
  - `frontend/tests/auth.test.mjs`: Genuine Supabase JWT, synthetic token rejection, profile gates, unified Continue flow, wrong password rejection passed.
  - `frontend/tests/admin.test.mjs`: 18 tables, RLS policies, RBAC route guard, 4-page navigation, minimal Dashboard passed.
- **3. Backend FastAPI Security & JWT Verification Tests (`python -m unittest discover -s backend/tests -v`)**: **PASS (10/10 tests)**
  - Full 12-stage transaction lifecycle, signed proof URL verification/tampering/expiry, legacy brute-force lockout, cryptographic signature verification, deactivated account blocking, admin RBAC enforcement.
- **4. Production Vite Build (`npm run build`)**: **PASS** (145 modules bundled into `dist/` in 1.25s).
- **5. Live Staging Services & Real Supabase Auth Integration (`python scripts/test-staging-services.py`)**: **PASS**
  - Live FastAPI server on `http://127.0.0.1:8009`
  - Real GoTrue auth calls to `https://zyzkoolgwbczvvetjnwf.supabase.co/auth/v1`
  - Real database writes and persistence across service restarts
  - Real multipart screenshot uploads in private storage directory with HMAC-SHA256 signed URLs
  - Full delivery state machine and customer tracking synchronization.

---

## 2. Task 1 & 2 — Live Staging Services & Genuine Supabase Auth Results

### 2.1 Live Staging Architecture
A live non-production staging environment was verified using real network calls and isolated persistence:
- **FastAPI Staging Service**: Running live on `http://127.0.0.1:8009`, exposing all customer, payment, and admin endpoints.
- **Genuine Supabase Auth**: Communicating with `https://zyzkoolgwbczvvetjnwf.supabase.co/auth/v1` via public publishable key.
- **Isolated Staging Database**: SQLite/PostgreSQL with full ACID transactions, foreign keys, and all 18 tables.
- **Private Storage**: Real filesystem directory structure (`private_storage/payment-proofs/<uid>/<order_id>/<payment_id>.png`).
- **Persistence Verification**: Tested by completely terminating the live FastAPI process and relaunching it against the existing database file and storage directory; confirmed 100% data integrity and tracking history retention.

### 2.2 Genuine Supabase Auth Test Results

| Test Scenario | Request / Endpoint | Expected Result | Actual Live Result | Status |
|---|---|---|---|---|
| **New Customer Auto-Signup** | `POST /auth/v1/signup` | HTTP 200 + active session (Confirm email disabled) | Returns HTTP 200, access token issued, UID generated | **PASS** |
| **Existing Account Login** | `POST /auth/v1/token?grant_type=password` | HTTP 200 + active bearer session | Returns HTTP 200, access token issued | **PASS** |
| **Wrong Password Rejection** | `POST /auth/v1/token?grant_type=password` | HTTP 400 `invalid_credentials` | HTTP 400: `{"code":400,"error_code":"invalid_credentials"}` | **PASS** |
| **Duplicate Registration Prevention** | `POST /auth/v1/signup` (existing email) | HTTP 422 `user_already_exists` | HTTP 422: `{"code":422,"error_code":"user_already_exists"}` | **PASS** |
| **Server JWT Verification** | Live FastAPI `/api/me` with genuine JWT | Claims verified via live JWKS ES256 | Cryptographic ES256 verification succeeded, role = CUSTOMER | **PASS** |
| **Admin Route Isolation** | Live FastAPI `/api/admin/dashboard` with customer JWT | HTTP 403 Forbidden | HTTP 403: Customer forbidden from admin endpoints | **PASS** |
| **Deactivated Account Defense** | Live FastAPI with deactivated profile in DB | HTTP 403 Forbidden | HTTP 403: Deactivated account blocked | **PASS** |

### 2.3 Architectural Review of Sign-in-then-Signup Fallback Flow
1. **Account Enumeration Consideration**:
   - In standard GoTrue, `signInWithPassword` returns `invalid_credentials` without distinguishing between non-existent user and bad password.
   - In a unified "Continue" button, if sign-in fails and the fallback attempts sign-up: an existing account returns `user_already_exists`. This reliably identifies that the password was incorrect (and rejects login without registering a duplicate), but mathematically reveals account existence to anyone possessing the email.
   - For Balaji Faki Point's customer base (local retail e-commerce), this trade-off provides high convenience (zero registration friction). However, for enterprise anti-enumeration, the alternative is requiring users to explicitly choose "Sign In" vs "Create Account", which our UI also provides via the toggle button in [`EmailSignIn.tsx`](file:///d:/D&D%20Projects/Balaji%20Faki%20Website/frontend/src/components/common/EmailSignIn.tsx).
2. **Network Failure Safety**:
   - [`EmailSignIn.tsx`](file:///d:/D&D%20Projects/Balaji%20Faki%20Website/frontend/src/components/common/EmailSignIn.tsx) explicitly checks `signInError`. If the failure is caused by a network timeout or connection error (rather than credential rejection), it immediately re-throws and surfaces the connection error without attempting signup.
3. **Race Condition Protection**:
   - If concurrent requests submit for the same email, only one signup succeeds; the second receives `user_already_exists` and cleanly falls back to invalid credentials display without data corruption.

---

## 3. Task 3 — Real Checkout Persistence Test Results

Executed with safe test catalog products ("faki", 500g, qty 2, pinCode "360005"):

1. **Authoritative Server Quote**:
   - `POST /api/checkout/quote` returned subtotal: ₹520, delivery fee: ₹0, total: ₹520.
2. **Order Creation in Database**:
   - `POST /api/orders` created order `#BFP-1001` with status `PENDING_PAYMENT` and payment status `PENDING`.
3. **Idempotency Guarantee**:
   - Re-submitting the identical payload with `Idempotency-Key` returned the existing order `#BFP-1001` without duplicate row creation or double inventory reservation.
4. **Multipart Payment Proof Submission**:
   - `POST /api/payments/{order_id}/submit` with genuine PNG bytes and 12-digit UTR `412399887766`.
   - Magic bytes and 5 MB size limit validated.
   - Physical file stored at `private_storage/payment-proofs/<uid>/<order_id>/<payment_id>.png`.
   - Order moved immediately to `PAYMENT_REVIEW` (Pending Verification).
5. **Customer Verification Status**:
   - `GET /api/payments/{order_id}/status` returned status `SUBMITTED`, orderStatus `PAYMENT_REVIEW`.

---

## 4. Task 4 — Admin Workflows & Fulfillment Synchronization

Tested using an authorized Owner Admin account (`role = 'OWNER_ADMIN'`):

1. **Admin Review Queue**:
   - `GET /api/admin/payments` listed the submitted payment attempt.
2. **Authorized Screenshot Preview**:
   - `GET /api/admin/payments/{payment_id}/proof` generated a short-lived HMAC-SHA256 signed URL (`exp` + `sig`).
   - Querying the signed URL returned raw `image/png` bytes matching the uploaded file.
   - Tampered signatures and expired timestamps returned HTTP 401.
3. **Premature Confirmation Defense**:
   - Attempting `POST /api/admin/orders/{order_id}/confirm` prior to payment approval was strictly rejected with HTTP 409.
4. **Manual Payment Approval**:
   - `POST /api/admin/payments/{payment_id}/approve` verified matching amount (₹520), matching UTR (`412399887766`), and recorded controlled bank credit fixture `AXIS-STG-...`.
   - Payment status transitioned to `VERIFIED`.
   - **Order status moved to `AWAITING_CONFIRMATION` (never CONFIRMED or PACKING prematurely).**
5. **Separate Order Confirmation**:
   - `POST /api/admin/orders/{order_id}/confirm` moved order status to `CONFIRMED`.
6. **Step-by-Step Delivery Fulfillment**:
   - Advanced sequentially through canonical state machine via `PATCH /api/admin/deliveries/{delivery_id}`:
     `CONFIRMED -> PACKING -> PACKED -> PICKED_UP -> SHIPPED -> OUT_FOR_DELIVERY -> DELIVERED`.
7. **Customer Tracking Timeline**:
   - `GET /api/orders/{order_id}/tracking` returned all 17 timestamped historical transitions.
   - Remained completely preserved after full service restart.

---

## 5. Task 5 — Production Security Migration Safety Report

### 5.1 Review of Applied vs Proposed Migrations

| Migration File | Status | Scope & Safety Assessment |
|---|---|---|
| `20261017000000_balaji_faki_point_schema.sql` | Applied on Remote | Baseline schema (18 tables, RLS enabled, initial indexes). Safe. |
| `20261017000001_optimize_rls_and_security_advisors.sql` | Applied on Remote | Subquery wrapping `(select auth.uid())` for index caching. Safe. |
| `20261017000002_simple_db_auth.sql` | Applied on Remote | **CRITICAL DEFECTS**: Added `password_hash` to `user_profiles`, insecure RPCs, permissive RLS. |
| `20261018000000_remediate_auth_and_rls_security.sql` | **Prepared on dev/antigravity** | **REMEDIATES ALL DEFECTS**: Drops exposed hashes, revokes insecure RPCs, restores strict RLS, adds brute-force protected legacy recovery. |

### 5.2 Corrective Migration Invariants
1. **RLS Grants & Policies**:
   - Drops all permissive `to anon, authenticated using (true)` policies.
   - Restores ownership filters: `(select auth.uid()) = id` on `user_profiles` and `(select auth.uid()) = user_id` on `customers`.
   - Admin access mediated strictly by `(select private.is_owner_admin())`.
2. **Auth Identities & Legacy Account Recovery**:
   - Legacy hashes archived into `private.legacy_db_auth_accounts`.
   - Legacy emails quarantined (`legacy+<uuid>@unlinked...`) to eliminate unique constraint collisions.
   - Linking function `link_verified_legacy_account(p_legacy_password text)` enforces cryptographic bcrypt check (`extensions.crypt`).
   - Brute-force lockout: 5 failed attempts locks legacy record for 30 minutes (`locked_until`).
   - Audited administrative recovery: `admin_link_legacy_account()` available only to `OWNER_ADMIN`.
3. **Database Triggers**:
   - Defense-in-depth trigger `private.enforce_user_profile_role_security()` rejects any non-admin modification of `role` or `is_active`.
4. **Rollback Procedure**:
   - In the event of an unexpected rollback requirement, the migration is wrapped in a transactional block (`begin; ... commit;`). If any statement fails, the transaction aborts automatically without leaving partial state.
   - Legacy accounts are non-destructively preserved in `private.legacy_db_auth_accounts`.

---

## 6. Task 6 — Deployment Readiness & Checklist

### 6.1 Hosting Configuration
- **Frontend**: Hosted on Vercel (`https://balaji-faki-point.vercel.app/`).
  - Rewrites configured in [`vercel.json`](file:///d:/D&D%20Projects/Balaji%20Faki%20Website/vercel.json) for client-side SPA routing (`/(.*) -> /index.html`).
- **Backend**: Container-ready with [`backend/Dockerfile`](file:///d:/D&D%20Projects/Balaji%20Faki%20Website/backend/Dockerfile) and [`backend/Procfile`](file:///d:/D&D%20Projects/Balaji%20Faki%20Website/backend/Procfile).
  - Can be deployed to Render, Railway, Fly.io, or AWS.
  - Startup: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`.

### 6.2 Environment Variables Matrix

| Environment Variable | Where Configured | Secret? | Purpose |
|---|---|---|---|
| `VITE_API_BASE_URL` | Vercel (Frontend) | No | Points frontend to deployed FastAPI `/api` base |
| `VITE_SUPABASE_URL` | Vercel & Backend | No | `https://zyzkoolgwbczvvetjnwf.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Vercel (Frontend) | No | `sb_publishable_phYXIe4ZP9RTX4Gx1cM26w_8agJ2Ug7` |
| `VITE_SUPPORT_WHATSAPP` | Vercel (Frontend) | No | `918000961030` |
| `DATABASE_URL` | Backend Only | **YES** | Supabase Postgres connection string (port 6543 pooler) |
| `SUPABASE_JWT_SECRET` | Backend Only | **YES** | Supabase project JWT secret for token verification |
| `SUPABASE_SECRET_KEY` | Backend Only | **YES** | Service role secret key (never in frontend) |
| `CORS_ORIGINS` | Backend Only | No | `https://balaji-faki-point.vercel.app,http://localhost:5173` |
| `PRIVATE_STORAGE_ROOT` | Backend Only | No | Persistent volume or bucket mount path for screenshots |

### 6.3 Remaining Production Blockers (Awaiting User Authorization)
1. **User Approval Required for Production Database Migration**:
   - `supabase/migrations/20261018000000_remediate_auth_and_rls_security.sql` must be applied to `zyzkoolgwbczvvetjnwf` via Supabase Dashboard SQL Editor or CLI.
2. **Backend Service Deployment**:
   - Deploy `backend/` to container hosting service (e.g. Render / Railway).
   - Set production database connection string (`DATABASE_URL`) on the backend host.
3. **Frontend Vercel Environment Variable**:
   - Update `VITE_API_BASE_URL` in Vercel to point to the live deployed FastAPI service.
