# Balaji Faki Point — Claude Project Audit (Phase 1)

- **Date:** 2026-10-19
- **Scope:** analysis only. No source, config, migration, env file, existing doc or git state was changed. Nothing was run against Supabase, Docker or a browser.
- **Labels:** VERIFIED (confirmed by code/command output) · INFERRED (strong evidence, not confirmed) · UNKNOWN · NEEDS CONFIRMATION.
- **Status words:** WORKING · PARTIALLY IMPLEMENTED · MISSING · BROKEN · NOT VERIFIED. "WORKING" here means the code path exists and is wired to a real endpoint; **no feature was verified against a live local Supabase stack** (see §7).

---

## 1. Git state (VERIFIED)

| Item | Finding |
|---|---|
| Branch | `dev/antigravity`, **no upstream configured** |
| HEAD | `3c93ff4` "Dev testing deplyement". `origin/main` is `935601b`, so HEAD is 1 commit ahead of `origin/main`. It exists on no remote branch, so upstream comparison is not possible. |
| Staged | none |
| Unstaged | 26 files (+656/−615), 1 deletion |
| Untracked source | `backend/tests/test_supabase_storage.py`, `frontend/src/features/store/storeApi.ts`, `supabase/migrations/20261019000000_product_information.sql`, `supabase/migrations/20261019000001_review_photos.sql` |
| Deleted (unstaged) | `scripts/test-staging-services.py` (remote staging script) |
| Config change | `supabase/config.toml` no longer has `project_id` (may break `supabase start`; untested) |
| Merge conflicts | None possible locally (single working branch, no upstream). |
| Main risk | All Codex work above exists only in this working tree. A reset/clean/checkout would lose it. Nothing was committed, stashed or pushed by this audit. |

Unfinished work in the tree: review-photo upload (see §6, item 4) and everything listed under Codex "Remaining".

### Existing agent docs
- `docs/CODEX_ACTIVE_TASK.md` — current handoff (modified, uncommitted). Its "Completed" list is largely consistent with the code. Its claim that the `TestClient` workflow test stalls on this machine was **not reproduced** here: `test_api_workflow` passed in 0.5 s (INFERRED: environment difference).
- `docs/ANTIGRAVITY_HANDOFF.md` — archived (header marks its remote/staging instructions obsolete). It still contains the production Supabase project ref, URL and publishable key.
- `README.md`, `docs/*.md`, `backend/README.md`, `frontend/README.md` — not audited line by line; `docs/testing/test-plan-and-results.md` refers to `tests/…` paths at the repo root, which do not exist (tests live in `frontend/tests/`).
- No `CLAUDE.md` or `AGENTS.md` exists in the repo.

---

## 2. Architecture actually implemented

| Layer | Implementation (VERIFIED) |
|---|---|
| Frontend | React 19, TypeScript 5.6, Vite 6, React Router 7, `@supabase/supabase-js`. npm workspace `frontend`. Feature-folder layout (`features/{admin,catalog,help,orders,payments,reviews,store}`). |
| Backend | FastAPI + SQLAlchemy 2. One 2,700-line `backend/app/main.py` (34 route decorators); router mounted both at `/api` and `/`. Helpers: `core/{config,domain,security,storage}.py`, `db/{models,seed,session}.py`, `schemas.py`. |
| Database | Schema source of truth = 6 Supabase SQL migrations. **Additionally** the ORM runs `create_all` at import (`main.py:2722` → `session.py`). An unset `DATABASE_URL` falls back to SQLite. |
| Auth | Supabase Auth. Backend verifies JWTs via JWKS (ES256/RS256/EdDSA) or HS256 with `SUPABASE_JWT_SECRET`; role comes only from `user_profiles.role`; only `OWNER_ADMIN` exists as an admin role. |
| Storage | Payment proofs → private Supabase bucket `payment-proofs` via HTTP and the server secret key. No filesystem fallback remains. Admin proof access = app-issued HMAC-signed URL proxied by FastAPI. |
| Deploy | `vercel.json`, `backend/Dockerfile`, `Procfile` (not used in this phase). |

### Local environment (names/hosts only; no secret values printed)
- `.env`, `backend/.env`, `frontend/.env` all exist and are gitignored. They point **only** to local services: API `127.0.0.1:54321`, Postgres `127.0.0.1:54322`, backend `127.0.0.1:8000/api`, CORS `localhost:5173`.
- **Supabase publishable/anon/secret key values are empty in all three files** (VERIFIED by length). Auth and Storage cannot function until keys are filled in from `supabase start` output.
- Tooling: Docker daemon **not running** (Linux engine pipe missing); `supabase` CLI not on PATH (`npx supabase` resolves to 2.121.0); Python 3.14.5 and Node 24.21 present; Python package **`psycopg` is not installed**, so the backend cannot connect to Postgres from this interpreter.
- `supabase/config.toml`: signup on, **`enable_confirmations = true`** (email confirmation required), no `[storage]` buckets (buckets are created by migrations).
- **Production references still present:** `.mcp.json` (tracked) points to production project `zyzkoolgwbczvvetjnwf`; `supabase/.temp/project-ref` links the CLI to it (gitignored). No production service was contacted during this audit.

---

## 3. Customer features

Global: `App.tsx` wraps the entire router in `AuthGate`, so **every page, including Home, Store, Help and Reviews, requires login and a completed profile** (name + phone).

| Feature | Route / file | Status | Evidence and notes |
|---|---|---|---|
| Homepage | `/` · `catalog/pages/HomePage.tsx` | PARTIALLY IMPLEMENTED | Order Faki / Order Supari hero actions and product info present (uncommitted). Data from `GET /products`; **falls back to hard-coded `PRODUCTS`** (`lib/api.ts:103`, Faki ₹250/500/1000, Supari ₹200/400/800) if the call or validation fails, labelled "Development preview" (`OrderContext.tsx:184`). |
| Product listing | section of homepage | PARTIALLY IMPLEMENTED | No separate page. |
| Product details | — | MISSING | No route; details only inline on the homepage card. |
| Login / signup | `AuthGate` → `components/common/EmailSignIn.tsx` | PARTIALLY IMPLEMENTED / NOT VERIFIED | "Continue" tries `signInWithPassword`, then on invalid credentials/400 calls `signUp` — **a mistyped email silently creates an account**. In-page `EmailSignIn` fallbacks (MyOrders, OrderDetails, QRPayment, Reviews) are unreachable behind `AuthGate`. |
| Order Form | `/order` · `OrderFormPage.tsx` | WORKING (NOT VERIFIED live) | `POST /checkout/quote`; draft in `sessionStorage` keyed by user. |
| Review Order | `/order/review` · `ReviewOrderPage.tsx` | WORKING (NOT VERIFIED live) | `POST /orders` with persisted `Idempotency-Key`. |
| QR Payment | `/order/payment` · `QRPaymentPage.tsx` | PARTIALLY IMPLEMENTED | Multipart `POST /payments/{id}/submit`. QR comes from server (`qrImageUrl` is now `None` unless a real QR asset is configured — **no QR asset exists yet**). Idempotency key regenerated on every call (`paymentsApi.ts:51`), so retries are not idempotent. |
| Payment Verification | `/order/verification` · `PaymentVerificationPage.tsx` | PARTIALLY IMPLEMENTED | Polls `GET /payments/{id}/status` every 15 s. **No in-app resubmit after rejection** (WhatsApp link only), although the backend allows a new attempt. |
| Order Confirmation | `/order/confirmation` | WORKING (NOT VERIFIED live) | `GET /orders/{id}` + payment status. |
| My Orders | `/my-orders` | WORKING (NOT VERIFIED live) | `GET /orders`. |
| Order Details + tracking | `/my-orders/:orderId` · `OrderDetailsPage.tsx` | WORKING (NOT VERIFIED live) | `GET /orders/{id}`, `/tracking`, `POST /cancel`. `/track` and `/track/:id` redirect to `/my-orders` (`router.tsx:58-59`). |
| Reviews (list/submit) | `/reviews` · `CustomerReviewsPage.tsx`, `reviewsApi.ts` | **BROKEN** (submit) / WORKING (list) | List: `GET /reviews[?product=]`. Submit: frontend now sends **multipart with up to 5 photos**; backend `POST /orders/{id}/review` accepts JSON only and no photo endpoint exists, so the uncommitted flow cannot work. |
| Visit Store | `/store` · `VisitStorePage.tsx` + new `storeApi.ts` | PARTIALLY IMPLEMENTED | Reads public `GET /store`. Response not validated (`storeApi.ts:15`; missing `supportPhone` would throw in `VisitStorePage.tsx:8`). Map is a placeholder; store photos missing. |
| Help / FAQs | `/help`, `/payment-flow` | WORKING (static) | Static FAQ array, no API. |
| Customer profile | — | MISSING | Name/phone captured once in `AuthGate`; no edit page. |

Routing: no broken links found; every `<Link>`/`navigate()` target exists in the router. No standalone Track nav item remains (matches requirement).

---

## 4. Admin panel

### Access control
- `AdminRouteGuard.tsx` calls `GET /api/me` and requires `role === 'OWNER_ADMIN'` (inactive users treated as CUSTOMER).
- **If `/api/me` fails, the JWT `app_metadata.role` claim alone unlocks the admin UI** (`orderStateMachine.ts:486`). Data stays protected because every `/admin/*` endpoint uses `get_owner_admin_principal` (role from `user_profiles`, never from JWT metadata). The header "Admin Panel" link uses `app_metadata.role` only.
- Backend: `user_metadata` can never grant admin (covered by `test_security.py`). Deactivated users get 403.
- No admin user is seeded; the owner must be promoted in the DB (UNKNOWN how the owner is expected to be created locally).

### Module status

| Module | Route | Status | Evidence |
|---|---|---|---|
| Dashboard | `/admin/dashboard` | WORKING (NOT VERIFIED) | `/admin/dashboard`, payments, orders; also fetches `/admin/orders/{id}` per order (N+1). |
| Price management / Products | `/admin/prices`, `/admin/products` (same page) | WORKING (NOT VERIFIED) | `GET/POST/PATCH /admin/products`; uncommitted product-information fields. Partial PATCH clears price and re-enables variant (§6). |
| Order management | `/admin/orders` | WORKING (NOT VERIFIED) | list, detail, `confirm`, `PATCH status`. |
| Payment verification | `/admin/payments` (not in sidebar) | WORKING (NOT VERIFIED) | `review`, `approve`, `reject`, signed proof. Approval ends at `AWAITING_CONFIRMATION`; confirm is a separate action. |
| Delivery management | `/admin/delivery` | WORKING (NOT VERIFIED) | `GET /admin/deliveries`, `PATCH /admin/deliveries/{id}`. |
| Feedback / reviews | `/admin/feedback`, `/admin/reviews` | WORKING (NOT VERIFIED) | `GET /admin/reviews`, `PATCH /admin/reviews/{id}`. Uncommitted `<img>` for photos can't carry a Bearer header. |
| Refunds / cancellations | `/admin/refunds` | WORKING (NOT VERIFIED) | approve, record-transfer. Completion likely fails on Postgres (§6 #1). |
| **Inventory** | `/admin/inventory` | **BROKEN** | UI calls `/admin/inventory` and `/admin/inventory/adjustments`; **backend defines neither** (VERIFIED by grep). Stock is only editable through product PATCH. |
| **Customers** | `/admin/customers` | **PLACEHOLDER** | Renders `SAMPLE_CUSTOMERS`; never calls its API helper; no backend endpoint. |
| **Reports** | `/admin/reports` | **BROKEN / PLACEHOLDER** | No backend `/admin/reports`; falls back to reference data. |
| **Notifications** | `/admin/notifications` | **BROKEN / PLACEHOLDER** | No backend `/admin/notifications` or retry endpoint; starts with sample logs. |
| **Settings** | `/admin/settings` | **BROKEN / RISKY** | No backend `/admin/settings`. Initial state is sample UPI/payee values; if the load fails, Save can still PATCH them. Store settings have no admin edit endpoint at all. |
| Navigation | sidebar | PARTIALLY IMPLEMENTED | Sidebar lists only Dashboard, Prices, Orders, Feedback; other modules reachable only by URL. |

---

## 5. Backend / database integration

### Endpoint index (`backend/app/main.py`)
Public: `GET /health`, `/products`, `/store`, `/reviews`; `POST /checkout/quote`.
Customer (Bearer): `GET /me`, `/orders`, `/orders/{id}`, `/orders/{id}/tracking`, `/payments/{id}/status`; `POST /orders`, `/orders/{id}/review`, `/orders/{id}/cancel`, `/payments/{id}/submit`.
Owner-admin: `GET /admin/dashboard`, `/admin/payments`, `/admin/payments/{id}`, `/admin/payments/{id}/proof` (also accepts HMAC-signed query), `/admin/orders`, `/admin/orders/{id}`, `/admin/deliveries`, `/admin/products`, `/admin/refunds`, `/admin/reviews`; `POST /admin/payments/{id}/{review|approve|reject}`, `/admin/orders/{id}/confirm`, `/admin/refunds/{id}/{approve|record-transfer}`; `PATCH /admin/orders/{id}/status`, `/admin/deliveries/{id}`, `/admin/products/{id}`, `/admin/reviews/{id}`.
**Not defined but called by the frontend:** `/admin/customers[/{id}]`, `/admin/reports`, `/admin/notifications[/{id}/retry]`, `/admin/settings`, `/admin/inventory[/adjustments]`.

### State machines (VERIFIED in `core/domain.py` + `main.py`)
- Payment: `PENDING → SUBMITTED → UNDER_REVIEW → VERIFIED`; `SUBMITTED/UNDER_REVIEW → REJECTED`.
- Order: `PENDING_PAYMENT → PAYMENT_REVIEW → AWAITING_CONFIRMATION → CONFIRMED → PACKING → PACKED → PICKED_UP → SHIPPED → OUT_FOR_DELIVERY → DELIVERED`, plus `CANCELLED` and `DELIVERY_FAILED`.
- Approval never sets `CONFIRMED`; `/confirm` is separate and requires a recorded bank credit; fulfilment states require a VERIFIED payment (also a DB constraint). `PATCH status` refuses `CONFIRMED` and payment states. Approval checks UTR match, exact amount, unique UTR and unique bank reference. Row locks, idempotency keys and immutable paise item prices are present. Cancellation releases/restores stock once and creates a pending refund only for verified payments.
- Stock is reserved at order creation and deducted at confirm; **reservations never expire**.

### Auth, storage, data
- JWT verification, claim checks and rejection of anon/service-role/synthetic tokens are tested (`test_security.py`, 9 tests).
- Proof upload moves a payment to `SUBMITTED` only after Supabase Storage succeeds; failures return 503 and roll back. A proof stored before a failed commit can be orphaned.
- Proof signing key falls back to a hard-coded string when no JWT secret/service key is configured (`storage.py:255-261`).
- Review-photo storage helpers, `ReviewPhoto` model, `review_photos` table and `review-photos` bucket exist, but **no endpoint uses them** (`main.py:41-67` imports only).
- Seed (`seed.py`) creates store settings, Faki/Supari products and six variants with hard-coded prices and 50 stock; creates no admin user.

### Migrations
1. `20261017000000_…schema` — 18 tables, `private` schema, `is_owner_admin()`, auth trigger, RLS, `payment-proofs` bucket; prices NULL, stock 0.
2. `20261017000001_…optimize_rls…` — RLS tuning.
3. `20261017000002_simple_db_auth` — **insecure** (password hash in public table, `using(true)` policies, self-promotion to admin, auto-signup RPC).
4. `20261018000000_remediate_auth_and_rls_security` — removes the above; role guard trigger reads `request.jwt.claim.role`, which newer PostgREST may not set (RLS still blocks).
5. `20261019000000_product_information` (untracked) — 6 nullable text columns; matches `models.py`.
6. `20261019000001_review_photos` (untracked) — table + private bucket; ORM type differs (varchar vs uuid) and omits CHECKs.

### Local SQLite/fixtures vs real Supabase Postgres
- **All backend tests use in-memory/file SQLite or mocks; none touch Postgres, Supabase Auth or Storage, or the network.** The Postgres-only defects in §6 therefore pass every test.
- Real local Supabase integration is **NOT VERIFIED**: Docker is down, keys are empty, `psycopg` is missing.

---

## 6. Critical defects and risks

| # | Severity | Finding | Evidence |
|---|---|---|---|
| 1 | HIGH | **Cancellation and refund completion fail on Postgres.** Code emits notification event types `ORDER_CANCELLED` and `REFUND_COMPLETED`; the DB CHECK allows only `CANCELLED` and `REFUND_PROCESSED`. Cancel → 500; refund completion → misleading 409 "reference already recorded". | schema.sql:569-582; main.py:604, 2623, 2635 (VERIFIED for the CHECK list; behaviour INFERRED) |
| 2 | HIGH | **PIN-code check silently disabled on Postgres.** `serviceable_pin_codes` is `jsonb` but mapped as Text; `json.loads(list)` raises, bare except yields `[]`, and every PIN is accepted. | schema.sql:621; models.py:498; main.py:732, 811 (VERIFIED code, behaviour INFERRED) |
| 3 | HIGH | **Public GETs write to the DB and fabricate data.** `ensure_catalog_seeded` runs on `GET /products` and quote/order, restoring default prices, product copy and 50 stock; contradicts the SQL rule "never fabricate prices". An admin price cleared to NULL is restored on the next public request. | main.py:684-686, 726, 791; seed.py:82-111 (VERIFIED) |
| 4 | HIGH | **Review photos half-built.** Migration, model, bucket, storage helpers and new frontend upload exist; no backend endpoint; submit flow broken. | main.py:41-67; reviewsApi.ts:59-73 |
| 5 | HIGH | **Insecure legacy migration** runs first on any `supabase db reset`. **Correction (Phase 2):** the archived `docs/ANTIGRAVITY_HANDOFF.md` §5.1 states migrations 1–3 were "Applied on Remote" and the remediation (`…000004`) was only "Prepared", never applied. So the remote project **may still be in the insecure state** (password hashes in a public table, permissive RLS). Not verified: the remote project was deliberately not contacted. | migrations/…000002; ANTIGRAVITY_HANDOFF.md §5.1 |
| 6 | MEDIUM | **Production references remain** (`.mcp.json`, CLI link, archived handoff). | VERIFIED |
| 7 | MEDIUM | **Local environment not runnable:** empty Supabase keys, no `SUPABASE_JWT_SECRET` in `.env.example`, `psycopg` missing, Docker stopped, local email confirmation on (blocks the "Continue" flow without Inbucket), `project_id` removed. | §2 |
| 8 | MEDIUM | **Admin Settings/Notifications/Reports** show sample data; Settings can persist sample UPI/payee values; no backend endpoints. | AdminSettingsPage |
| 9 | MEDIUM | **Whole site behind login**, silent account creation on mistyped email. | App.tsx, EmailSignIn |
| 10 | MEDIUM | Stock reservations never expire; `create_all` against Postgres plus deploy order (code before the two new migrations breaks queries/startup). | main.py:909; session.py |
| 11 | MEDIUM | No resubmit UI after payment rejection; payment-submit idempotency key regenerated per call. | PaymentVerificationPage, paymentsApi.ts:51 |
| 12 | LOW | Unhandled `ValueError` in delivery PATCH → 500 (main.py:2236); review text length checked before trim (main.py:1078); partial product PATCH nulls price and re-enables variant (main.py:2437-2446); `description_gu` ignored; JWKS client rebuilt per request (security.py:155); N+1 admin fetches; one catalog field error drops the whole live catalog to hard-coded prices (contracts.ts:88); `GET /store` unvalidated; lockout test checks a function defined in the test itself (test_security.py:168); stray tracked file `backend/New Microsoft Excel Worksheet.xlsx` (contents not inspected); a personal email used as an input placeholder (`AdminRouteGuard.tsx:197`). |

---

## 7. Verification run during this audit (observed)

| Check | Result |
|---|---|
| `npm run typecheck` | **PASS** (exit 0) |
| `npm test` (4 frontend suites: checkout, secondary-pages, auth, admin) | **PASS** (exit 0) |
| Backend unit tests, run per file with `python -m unittest discover -s backend/tests -p <file>` | **PASS** — 26 tests: security 9, payment state machine 4, local config 1, catalog details 3, supabase storage 4 (mocked HTTP), review service 1, cancellation 1, delivery state 2, api workflow 1 (SQLite, patched storage) |
| `npm run build` | NOT TESTED (skipped to leave `dist/` untouched) |
| Local Supabase migrations / RLS / Storage / Auth | NOT TESTED (Docker stopped, keys empty) |
| Browser / end-to-end flow | NOT TESTED |
| Postgres-backed backend tests | NOT TESTED (`psycopg` not installed; no Postgres test suite exists) |

Note: a first backend run with `python -I` failed on imports (my invocation, `-I` removes the repo path); it is not a repo defect.

---

## 8. Assumptions and uncertainties
- Assumed `OWNER_ADMIN` is the only admin role.
- "WORKING (NOT VERIFIED)" labels come from code reading plus the SQLite/mocked tests above.
- Frontend/backend path mismatches in §4–5 are VERIFIED by grep (`@router` decorators vs `features/admin/api/index.ts`).
- Postgres behaviour in §6 items 1–2 is INFERRED from schema vs code, not executed.
- The docs' statement that production data was untouched is UNKNOWN from this checkout.

## 9. Questions requiring a decision
1. How should the uncommitted work be protected before Phase 2 (local commit on `dev/antigravity`, a backup branch, or leave as is)?
2. Was `20261017000002_simple_db_auth.sql` ever applied to the production project?
3. May `.mcp.json` and the `supabase/.temp` link be repointed/removed so production cannot be touched accidentally?
4. Should Home, Store, Help and Reviews be browsable without login?
5. Should local email confirmation be off for development sign-up?
6. Are the temporary prices final (Faki 250g/500g/1kg = ₹250/500/1,000; Supari ₹200/400/800), and who supplies product facts, store photos and the QR asset?
7. Which admin modules are required for launch (Inventory, Customers, Reports, Notifications, Settings currently have no backend)?
