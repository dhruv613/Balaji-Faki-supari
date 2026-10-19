# Balaji Faki Point — Change Plan (Phase 2 → Phase 3)

- **Date:** 2026-10-19 · **Base:** `dev/antigravity` @ `7587029` · **Inputs:** `CLAUDE_FINAL_REQUIREMENTS.md`, `CLAUDE_PROJECT_AUDIT.md`
- **Status:** plan only. No source, config, migration or env file has been changed for Phase 3. Awaiting approval.
- **Rules for execution:** local-only; forward-only migrations; each work package (WP) ends with its checks and its own local commit (no push); existing audit logs, payment records, orders and customers are preserved.
- Priorities follow the owner's P0/P1/P2 lists. IDs `C-/A-/R-/S-/L-` refer to the requirements file.

---

## 1. Defect classification

**Confirmed by reading code/config (no database needed)**
- Public `GET /products`, quote and order call `ensure_catalog_seeded` and write defaults (`main.py:176,686,726,791,1366,2358`; `seed.py:40-111`).
- `AuthGate` wraps the whole app (`App.tsx`), so nothing is public.
- `EmailSignIn` silently signs up on any invalid-credentials/400 (`EmailSignIn.tsx` "Unified single Continue flow").
- Review submit sends multipart but the endpoint takes JSON; review-photo helpers are imported and never used (`main.py:41-67,1052`).
- Payment-submit idempotency key is regenerated per call (`paymentsApi.ts:51`); no rejection/resubmit UI (the status API already returns the reason and allows a new attempt).
- Frontend calls `/admin/inventory*`, `/customers*`, `/reports`, `/notifications*`, `/settings`; none exist in `main.py`. Customers/Reports/Notifications/Settings pages start from `SAMPLE_*` data.
- Partial product PATCH nulls omitted prices and re-enables variants (`main.py:2437-2446`, `schemas.py:164`).
- Production references: `.mcp.json`, `supabase/.temp/*` link, archived handoff; `project_id` removed from `config.toml`; `enable_confirmations = true`; Supabase keys empty in all `.env`; `psycopg` not installed; Docker stopped.
- Admin UI unlocks from the JWT `app_metadata.role` when `/api/me` fails (`orderStateMachine.ts:486`).
- Hard-coded proof-signing fallback key (`storage.py:255-261`); JWKS client rebuilt per request (`security.py:155`); unhandled `ValueError` in delivery PATCH (`main.py:2236`).
- Order timeline shows only completed events, not the fixed 5-step view (`OrderDetailsPage.tsx:67`); phone literals hard-coded in several pages.
- `store_settings.support_email` default and the seeded UPI ID are unverified/possibly invented values (`models.py:488,492`; `seed.py`).

**Confirmed by comparing schema with code, behaviour not yet executed (needs PostgreSQL run)**
1. Notification `event_type` CHECK rejects `ORDER_CANCELLED`/`REFUND_COMPLETED` (SQL allows `CANCELLED`/`REFUND_PROCESSED`) → cancel 500 / refund-complete misleading 409.
2. `serviceable_pin_codes` is `jsonb`, ORM maps Text → `json.loads(list)` fails and every PIN passes.
3. `create_all` at import against Postgres conflicts with SQL-managed `review_photos` (varchar FK vs uuid).
4. `reviews.review_text` CHECK (≥10 chars after trim) vs schema validation before trim → wrong 409.

**Assumptions that still require a real local run**
- Local GoTrue's token algorithm (JWKS asymmetric vs HS256 secret) and what `.env` the backend needs (`SUPABASE_JWT_SECRET` is missing from `.env.example`).
- Whether the role-guard trigger from migration `…000004` ever fires (reads `request.jwt.claim.role`).
- RLS behaviour after the full migration chain; `sync_my_profile` RPC; Storage bucket creation and the server-key upload path.
- Whether `supabase start` works without `project_id` (the CLI may reject it).
- Local email confirmation behaviour once switched off; whether a local MCP endpoint exists for the installed CLI (2.121.0).

---

## 2. Gap analysis

Action: KEEP / MODIFY / ADD / REMOVE / FIX · Priority per owner's P0/P1/P2.

### 2a. Local environment, database, security
| Feature | Current | Required | Action | Files | Pri |
|---|---|---|---|---|---|
| Prod isolation | `.mcp.json` → production; CLI linked via `supabase/.temp` | Nothing local can reach production | FIX | `.mcp.json`, `supabase/.temp/*` (ignored), `supabase/config.toml`, new `scripts/check-local-only.mjs`, `scripts/verify-all.mjs` | P0 |
| Local stack | Docker down, empty keys, `psycopg` missing, confirmations on | Auth+DB+Storage start and talk | FIX | `supabase/config.toml`, `.env*` (local), `.env.example`, `backend/requirements.txt` (already lists psycopg), `README.md` | P0 |
| Migration chain | #3 insecure, #4 remediates; trigger may not fire | Safe final state, proved by SQL assertions | ADD | new `supabase/migrations/20261020000000_final_security_state.sql`, `scripts/check-db-security.py` | P0 |
| Notification enum | code ≠ CHECK | code and DB agree | FIX | new migration (superset CHECK), `main.py:604,2623` | P0 |
| PIN type | jsonb vs Text | list works on Postgres and SQLite | FIX | `backend/app/db/models.py:498`, `main.py:732,811` | P0 |
| Schema authority | `create_all` at import on Postgres | Postgres = migrations only; `create_all` for SQLite/tests | MODIFY | `backend/app/db/session.py`, `main.py:2722` | P0 |
| GET/quote/order seeding | writes defaults | read-only | FIX | `main.py`, `backend/app/db/seed.py` | P0 |
| Dev seed | automatic, fabricated, real-looking UPI | explicit `python -m app.db.seed --dev`, labelled, LOCAL TEST payment | MODIFY | `seed.py`, `models.py` defaults, `README.md` | P0 |
| Dev admin | none | explicit dev-only owner admin | ADD | `seed.py` (`--dev-admin`) | P1 |
| Price/payment confirmation | none | `price_confirmed`, `business_settings_confirmed_at`, go-live guard | ADD | new migration, `models.py`, `main.py` (quote/orders), `AdminProductsPage.tsx`, `AdminSettingsPage.tsx` | P1 |
| Stock reservations | never released | safe expiry/release | ADD | `main.py` (+ small service helper), `models.py`, tests | P1 |
| Postgres tests | none (all SQLite) | transactional Postgres suite + Storage test | ADD | `backend/tests/test_postgres_*.py`, `backend/tests/conftest.py` | P0 |
| Proof signing key | hard-coded fallback | fail closed outside local | FIX | `backend/app/core/storage.py:255-261` | P1 |
| JWKS client | per request | cached | FIX | `backend/app/core/security.py:155` | P2 |
| Delivery transition error | 500 | 409 | FIX | `main.py:2229-2240` | P2 |
| ORM/SQL drift | refund_date, audit jsonb, review_photos types | aligned | FIX | `models.py` | P2 |
| Orphaned proof on failed commit | possible | cleanup on failure | FIX | `main.py:1242-1305` | P2 |
| Tracked `backend/New Microsoft Excel Worksheet.xlsx` | unknown contents | owner decides | ASK | that file | P2 |

### 2b. Customer
| Feature | Current | Required | Action | Files | Pri |
|---|---|---|---|---|---|
| Public browsing | all behind `AuthGate` | Home/Store/Help/Reviews/Product public | MODIFY | `frontend/src/app/App.tsx`, `app/router.tsx`, `components/common/AuthGate.tsx`, `components/layout/Header.tsx`, `context/OrderContext.tsx` | P1 |
| Protected routes | n/a | `RequireAuth` on `/order*`, `/my-orders*`, `/account`, review submit; return-to path | ADD | `components/common/RequireAuth.tsx`, `router.tsx`, login route/page | P1 |
| Sign-in / sign-up | silent sign-up | explicit flows (after approval) | MODIFY | `components/common/EmailSignIn.tsx` | P1 (ASK) |
| Profile update | one-time gate form | Account page | ADD | `features/account/pages/AccountPage.tsx`, `lib/supabase.ts`, `router.tsx` | P1 |
| Order draft | keyed by user id | works anonymously, merges on login | MODIFY | `context/OrderContext.tsx`, `lib/customer.ts` | P1 |
| Home | hard-coded fallback prices; no ratings | DB prices, error state instead of fake prices, ratings | MODIFY | `features/catalog/pages/HomePage.tsx`, `lib/api.ts:103`, `OrderContext.tsx:181-184` | P1 |
| Product details | none | `/products/:slug` with all fields | ADD | `features/catalog/pages/ProductDetailsPage.tsx`, `catalogApi.ts`, `lib/contracts.ts`, `router.tsx`, `main.py` (`GET /products/{slug}`) | P1 |
| Product fields | 6 text fields | + shelf life, packaging, safety disclosures; empty = hidden | MODIFY | new migration, `models.py`, `schemas.py`, `main.py:716-`, `contracts.ts` | P1 |
| Product images | one `image_url` | multiple, admin-managed | ADD | new migration `product_images`, `storage.py`, `main.py`, `AdminProductsPage.tsx` | P1 |
| Order form / review order | working | keep; show backend delivery charge | KEEP | `features/orders/pages/OrderFormPage.tsx`, `ReviewOrderPage.tsx` | — |
| QR payment | no QR asset; real-looking UPI | LOCAL TEST banner + configured QR | MODIFY | `features/payments/pages/QRPaymentPage.tsx`, `main.py` (payment block), Settings | P1 |
| Payment idempotency | new key per call | stable per attempt | FIX | `features/payments/api/paymentsApi.ts:51`, `QRPaymentPage.tsx` | P1 |
| Rejection / resubmit | WhatsApp link only | reason + "submit new proof" | ADD | `PaymentVerificationPage.tsx`, `QRPaymentPage.tsx`, `main.py:1320` (structured `rejectionReason`, `canResubmit`, `attempts[]`), `lib/contracts.ts` | P1 |
| Order Details timeline | completed events only | 5-step vertical timeline + pre-confirmation payment states | MODIFY | `features/orders/pages/OrderDetailsPage.tsx`, new `features/orders/lib/customerTimeline.ts` | P1 |
| Track page | removed; redirects | keep | KEEP | `router.tsx:58-59` | — |
| Review submit | broken multipart | working with ≤5 photos | FIX | `main.py:1052`, `core/storage.py`, `schemas.py`, `reviewsApi.ts`, `CustomerReviewsPage.tsx` | P0 |
| Review summary / sort | none | average, 1–5 distribution, count, sort | ADD | `main.py:2642`, `reviewsApi.ts`, `CustomerReviewsPage.tsx`, `HomePage.tsx` | P1 |
| Review photo access | none | published: proxied public read; others: owner/admin only | ADD | `main.py` (photo route + signed URL), `storage.py` | P0 |
| Duplicate review / trim | length checked before trim | normalise first; clear 409 | FIX | `schemas.py:108`, `main.py:1078` | P1 |
| Review publish policy | `PENDING_MODERATION` | publish then moderate (ASK) | MODIFY | `models.py:388`, `main.py`, `AdminReviewsPage.tsx` | P1 (ASK) |
| Visit Store | minimal `/store`, unvalidated, placeholder map | full profile, photos, validated, owner-editable | MODIFY | `main.py:716`, `models.py` StoreSettings, `features/store/storeApi.ts`, `VisitStorePage.tsx` | P1 |
| Store photos / content | none | admin-managed | ADD | new migration `store_photos` + settings columns, `storage.py`, `main.py` | P1 |
| Contact literals | `tel:+918000961030` in pages | from store profile | MODIFY | `OrderDetailsPage.tsx`, `AuthGate.tsx`, `HelpFAQsPage.tsx`, `Header.tsx`/footer | P2 |
| Help | static FAQ | keep, public | KEEP | `features/help/pages/HelpFAQsPage.tsx` | — |
| Loading/empty/error states | uneven | consistent | MODIFY | customer pages | P2 |

### 2c. Admin
| Feature | Current | Required | Action | Files | Pri |
|---|---|---|---|---|---|
| Main navigation | already four items | keep | KEEP | `features/admin/components/AdminSidebar.tsx` | — |
| Contextual access | Payments/Delivery/Refunds/Inventory/Customers/Settings only by URL | linked from the four pages | MODIFY | `AdminOrdersPage.tsx`, `AdminProductsPage.tsx`, `AdminHeader.tsx` | P1 |
| Reports / Notifications | sample data, no backend | hidden until built | REMOVE (routes only) | `app/router.tsx:83-84` (keep page files and DB tables) | P1 |
| Dashboard | 823 lines, N+1 per-order calls | exactly Products Sold, Net Profit, Pending Payments table; one data call | MODIFY | `AdminDashboardPage.tsx`, `main.py:1361` | P1 |
| Net profit | backend returns null without costs | "Not available: add cost prices"; dev-cost notice | MODIFY | `main.py:1361-1430`, `AdminDashboardPage.tsx` | P1 |
| Price management | partial PATCH clears price/re-enables | omitted = unchanged; explicit null needs confirmation; images; availability | FIX | `main.py:2390-2446`, `schemas.py:164`, `AdminProductsPage.tsx` | P1 |
| Order management | per-order detail calls; payments/delivery/refunds on separate pages | one list call; payment review, confirm, packing, shipping, delivery person, cancel/refund reachable from it | MODIFY | `AdminOrdersPage.tsx`, `AdminPaymentsPage.tsx`, `AdminDeliveryPage.tsx`, `AdminRefundsPage.tsx`, `main.py:1863` | P1 |
| Feedback management | photos via bare `<img>` (no Bearer) | secure photo view, spam hide with reason, reply | MODIFY | `AdminReviewsPage.tsx`, `main.py:2660-2700` | P1 |
| Inventory | no backend | `GET /admin/inventory`, `POST /admin/inventory/adjustments` on `InventoryMovement` | ADD | `main.py`, `AdminInventoryPage.tsx`, `features/admin/api/index.ts:271-281` | P1 |
| Customers (read-only) | sample data | real list/detail | ADD | `main.py`, `AdminCustomersPage.tsx`, `features/admin/api/index.ts:317-331` | P1 |
| Settings | no backend; sample UPI/payee can be saved | real GET/PATCH, QR upload, audit, no placeholder saves | ADD/FIX | `main.py`, `AdminSettingsPage.tsx`, `features/admin/lib/referenceData.ts` | P1 |
| Admin guard | UI opens on JWT claim if `/me` fails | require successful `/me` | FIX | `AdminRouteGuard.tsx`, `features/admin/lib/orderStateMachine.ts:486` | P1 |
| Placeholder email | real-looking address | neutral | FIX | `AdminRouteGuard.tsx:197` | P2 |
| Sample constants | `SAMPLE_*`, `buildReferenceReport` | removed from live pages | REMOVE | `features/admin/lib/referenceData.ts` and importing pages | P2 |
| Role model | only `OWNER_ADMIN` | same | KEEP | `core/security.py` | — |

---

## 3. Local-only isolation procedure (P0, needs your OK to edit)

Nothing here contacts the remote project. Steps are reversible.

1. **MCP:** replace the production URL in tracked `.mcp.json` with an empty `mcpServers` (default). A local MCP endpoint is added only if the installed CLI (2.121.0) documents one — UNKNOWN today.
2. **CLI link:** move (not delete) the link files in the gitignored `supabase/.temp/` (`project-ref`, `linked-project.json`, `pooler-url`, `gotrue/rest/storage version files` stay) into `supabase/.temp-prod-link-backup/` so `--linked` commands cannot resolve the production ref.
3. **Config:** set `project_id = "balaji-faki-local"` in `supabase/config.toml` (the CLI likely needs it; verify on `supabase start`); `[auth.email] enable_confirmations = false`; keep ports 54321/54322; declare local buckets in config where supported while migrations stay authoritative.
4. **Command discipline:** only `supabase start`, `status`, `stop`, `db reset` (local), never `link`, `db push`, `--linked`, `projects`, `migration repair`.
5. **Guard script** `scripts/check-local-only.mjs`, run by `npm run verify`: fails if any tracked file other than the archived handoff or audit docs contains `supabase.co` or the production ref, if any `.env*` URL host is not `127.0.0.1`/`localhost`, or if `.mcp.json` lists a remote server.
6. **Not changed:** `docs/ANTIGRAVITY_HANDOFF.md` (archived; contains the production ref and publishable key) is left intact.
7. **Heads-up (data safety):** the archived handoff says migrations 1–3 *were applied* to the remote project and the remediation was *not*. The remote may therefore still expose password hashes. I will not check. Recommendation: a reviewed remediation runbook for the deployment phase (see §9, Q4).

---

## 4. Work packages

Sequence: **WP0 → WP1 → WP2 → WP3** (P0 gate) → WP4–WP9 (customer, can interleave) → WP10 (admin) → WP11 → WP12. Each WP: local commit, then checks listed.

### WP0 — Isolation (P0) · depends on: your approval of §3
- Do §3 steps 1–5. Add `check-local-only` to `scripts/verify-all.mjs`.
- **Tests:** guard script PASS; negative test (temporary bad URL) FAILS as expected.
- **Done when:** no tracked/active config references the remote project; `git grep` for the ref hits only archived docs.

### WP1 — Local stack bring-up (P0) · depends on: WP0, **you start Docker Desktop (Linux engine)**
- Run `supabase start`; copy local URL/keys into the three `.env` files (values never printed); add `SUPABASE_JWT_SECRET`/JWKS notes to `.env.example`; `pip install -r backend/requirements.txt` (adds `psycopg`).
- Run `supabase db reset` to apply the current six migrations; record the first real results (including the failures predicted in §1).
- Add `scripts/smoke-local.py` skeleton: health, Auth sign-up/login on local GoTrue, Storage bucket read/write with the server key.
- **Done when:** local Auth, Postgres and Storage respond; backend boots against Postgres; failures are listed, not hidden.

### WP2 — Database final state (P0) · depends on: WP1
- New migration `20261020000000_final_security_state.sql` (forward-only; migrations 1–4 untouched):
  - Idempotently re-assert: no `password_hash` column or legacy RPCs; no permissive `anon/authenticated using(true)` policies; strict ownership/admin policies; `sync_my_profile` present.
  - Replace the role-guard trigger to read claims via `auth.jwt()`/`request.jwt.claims` (no dependence on `request.jwt.claim.role`).
  - Extend `notifications.event_type` CHECK to a **superset** (adds `ORDER_CANCELLED`, `REFUND_COMPLETED`).
- New migration `20261020000001_catalog_store_content.sql`: product `shelf_life`, `packaging`, `safety_disclosures` (existing `production_packaging`/`safety_storage` kept and relabelled "Preparation/production" and "Storage"); `product_images`; `product_variants.price_confirmed boolean default false`; `store_photos`; store content columns (`shop_intro`, `production_info`, `provider_manufacturer`, `packaging_info`, `business_settings_confirmed_at`); public buckets `product-images`, `store-photos` (server-only write), private `payment-qr`.
- Review changes only if missing in the schema: `review_photos` RLS stays; add `reviews.moderation_note` when absent.
- `scripts/check-db-security.py`: executable assertions after `db reset` (anon cannot read `user_profiles`/`customers`; user cannot change own role; no hash column; buckets private/public as designed).
- **Tests:** `check-db-security.py` PASS on a clean reset **and** on a database where migrations 1–4 were applied first.
- **Done when:** clean `db reset` ends in the safe final state, proved by script output.

### WP3 — Backend P0 fixes · depends on: WP2
1. **Seeding:** remove `ensure_catalog_seeded` from `list_public_products`, `checkout/quote`, `create_order`, admin dashboard/products and `_get_store_settings`; settings singleton comes from a migration insert; missing data ⇒ clear 503/empty list, never writes. `python -m app.db.seed --dev [--dev-admin]` is the only initialiser; Faki 1 kg = ₹1,000 confirmed, others `price_confirmed=false`; LOCAL TEST UPI/payee; no invented email; never overwrites existing rows.
2. **PIN type:** ORM uses a JSON type that works on SQLite and `jsonb`; validate PIN list on write.
3. **Schema authority:** `init_db()`/`create_all` only for SQLite/tests.
4. **Money guards:** quote/order refuse variants with `price IS NULL` (422); outside local mode also refuse `price_confirmed=false` or `business_settings_confirmed_at IS NULL`.
5. **Delivery PATCH:** wrap order-transition validation (409).
6. **Proof signing:** fail closed when no signing secret outside local.
- **Tests (SQLite + Postgres):** GET/quote/order create no rows; cleared price stays cleared; PIN allow/deny on Postgres; cancel and refund-complete succeed with notifications; delivery invalid transition → 409.
- **Done when:** all three predicted Postgres failures are demonstrated fixed on real local Postgres.

### WP4 — Public browsing and authentication (P1) · depends on: WP1
- Replace app-wide `AuthGate` with `RequireAuth` on `/order*`, `/my-orders*`, `/account`; add `/login` with `next` return path; header shows Login/Account; profile (name+phone) required only at checkout.
- `OrderContext`: anonymous draft in `sessionStorage` (key `anon`), moved to the user's key after login.
- After approval of §7 of the requirements: rewrite `EmailSignIn` into explicit Sign in / Create account (confirm email, name, mobile), forgot-password link; remove in-page `EmailSignIn` fallbacks.
- `AccountPage` for name/mobile via existing `auth.updateUser` + `sync_my_profile`.
- `AdminRouteGuard`: require successful `/api/me`.
- **Tests:** extend `frontend/tests/auth.test.mjs` (public routes render without session; protected redirect+return; typo email creates nothing; duplicate email message); backend `/me` unchanged.
- **Done when:** Home/Store/Help/Reviews open logged-out; ordering prompts login and resumes; real local sign-up and login work without email confirmation.

### WP5 — Products and product details (P1) · depends on: WP2, WP3
- `GET /products` (read-only, with `averageRating`, `reviewCount`), `GET /products/{slug}`; admin product API accepts new fields and image upload/ordering/removal.
- `ProductDetailsPage` with gallery, pack-size selector, price, all populated fields, ratings, reviews, Order CTA; Home cards link to it. Empty fields hidden; no invented copy.
- Remove hard-coded fallback prices (`lib/api.ts:103`): on API failure show an error/empty state.
- **Tests:** contracts for new fields (extend `frontend/tests/checkout.test.mjs`), `test_catalog_details.py` extensions, upload test on local Storage.
- **Done when:** a product with only a name+price renders cleanly; populated fields render; prices always come from Postgres.

### WP6 — Reviews (P0 for fix, P1 for rest) · depends on: WP2, WP3
- `POST /orders/{id}/review` multipart: `rating`, `reviewText`, `photos` (≤5) using existing `validate_review_photo/store_private_review_photo`; cleanup on rollback; trim before length check; unique per order (single-item orders today; migrate to `order_item_id` if multi-item is ever added).
- `GET /reviews?product=&sort=newest|oldest|highest|lowest` returns `summary {average, count, distribution{1..5}}`; photos exposed as authorised URLs; `GET /reviews/photos/{id}` public for PUBLISHED, otherwise owner/admin (short-lived HMAC URL or Bearer fetch).
- Admin: photo viewing with auth, spam hide with required reason (audit-logged), reply; hide never deletes; negative ratings never filtered.
- Default publishing per your answer (Q3).
- **Tests:** multipart contract (frontend↔backend), duplicate 409, non-delivered 403, photo auth matrix, distribution maths, sort.
- **Done when:** a delivered order's customer submits a review with 2 photos locally; public sees it per policy; admin views photos; owner of another order cannot.

### WP7 — Our Shop (P1) · depends on: WP2
- Extend `GET /store` (intro, address, hours, phone/WhatsApp/email when set, production info, provider, packaging, photos); validate response in `storeApi.ts`; `useStoreProfile` hook used by Store, Help, Order Details, Header.
- Admin Settings edits those fields and manages store photos.
- **Tests:** public response excludes UPI/QR; empty content hidden; contract tests.
- **Done when:** no hard-coded contact/address literals remain in customer pages.

### WP8 — Payment retry and idempotency (P1) · depends on: WP3
- Frontend stable `Idempotency-Key` per attempt (persisted per order+UTR+file fingerprint, reused on retry/double click, new key only for a genuinely new attempt).
- `/payments/{id}/status` adds `rejectionReason`, `canResubmit`, customer-safe `attempts[]`.
- `PaymentVerificationPage`: REJECTED state shows reason and a "Submit new payment proof" action to `/order/payment`; SUBMITTED/UNDER_REVIEW show "Payment Verification Pending"; LOCAL TEST banner on QR page.
- **Tests:** replay same key → same attempt; double submit → one attempt; same UTR twice; reject → resubmit → approve; storage failure leaves state unchanged.
- **Done when:** the full reject-then-retry journey works against local services.

### WP9 — Order Details timeline (P1) · depends on: WP3
- `customerTimeline.ts` maps detailed history to Order Confirmed · Packed · Shipped (PICKED_UP/SHIPPED) · Out for Delivery · Delivered, with pending steps greyed and real timestamps; PACKING shows "Packing in progress"; before CONFIRMED a status banner (awaiting payment / verification pending / verified, awaiting shop confirmation); CANCELLED and DELIVERY_FAILED banners.
- Contact buttons from store profile; reuse existing page and styles (vertical `timeline` class).
- **Tests:** table-driven unit tests over every order state (node test).
- **Done when:** every state renders the correct banner and steps; no Track entry anywhere.

### WP10 — Admin completion (P1) · depends on: WP3, WP5–WP7
1. **Price Management:** `exclude_unset` semantics; explicit-null price requires confirm flag and makes variant unorderable; `is_available` only changes when sent; apply `description_gu`; images; "development price" badges and Confirm-price action; audit log entries.
2. **Dashboard:** one endpoint returning Products Sold, Net Profit (or reason) and the pending-payments rows including order summary; frontend reduced to those three elements.
3. **Order Management:** list endpoint includes items, payment state and latest attempt (no per-order calls); payment review, separate confirm, packing/shipping, delivery person, cancellation/refund, and history reachable from it; Payments/Delivery/Refunds become contextual routes linked from here.
4. **Inventory:** `GET /admin/inventory` (variants, available = total − reserved, low-stock flag, recent movements), `POST /admin/inventory/adjustments` (row lock, reason required, `InventoryMovement`, audit).
5. **Customers (read-only):** `GET /admin/customers[?q]`, `GET /admin/customers/{id}` with order summaries; wire page; delete sample data.
6. **Settings:** `GET/PATCH /admin/settings` (shop details, UPI/payee, delivery charge/threshold, PINs, reservation expiry), QR upload to private `payment-qr`, `business_settings_confirmed_at` confirmation action, audit entries; Save disabled until a successful load.
7. **Reports/Notifications:** remove the two routes only (§2c).
- **Tests:** each endpoint's auth (customer 403, anonymous 401), validation, audit rows; partial-PATCH regression; inventory concurrency; dashboard maths with and without costs.
- **Done when:** every visible admin screen uses real endpoints; no `SAMPLE_*` reachable; main nav still four items.

### WP11 — Cancellation, refund and expiry (P1) · depends on: WP3, §6 approval
- Implement the approved §6 policy using existing `Refund` flow and the SQL `cancellation_requests` table (add ORM model if "request" step is approved); reservation expiry job (lazy release on quote/order/admin reads plus a startup background loop), idempotent and row-locked.
- **Tests:** release exactly once; never expires orders with a submitted/verified proof; refund creation only for verified payments; late-proof behaviour.
- **Done when:** stock cannot be held indefinitely and every money path has a test.

### WP12 — Cleanup, responsive and verification (P2)
- Remove obsolete sample data/constants and unreachable code; loading/empty/error states; 375/768/1440 responsive pass of changed pages; remove duplicate per-order fetches; cache JWKS; align ORM types; orphaned-proof cleanup.
- Full verification (§7), update `docs/CODEX_ACTIVE_TASK.md` handoff (append only) and README local-dev section.

---

## 5. Migration list (forward-only)
| File | Purpose |
|---|---|
| `20261020000000_final_security_state.sql` | Safe final policies/trigger, notification CHECK superset, helper assertions |
| `20261020000001_catalog_store_content.sql` | Product fields, `product_images`, `price_confirmed`, store content, `store_photos`, buckets |
| `20261020000002_*` (only if needed) | `reviews.moderation_note`, `cancellation_requests` adjustments |

Existing applied migrations are never edited. All migrations are re-runnable (`if not exists`, guarded drops) and tested on an empty database and on one that already has migrations 1–4.

---

## 6. Money and policy proposals (**ASK** before WP11 / WP6 are finalised)

**Cancellation and refunds (proposed defaults)**
| Stage | Customer | Admin | Money | Stock |
|---|---|---|---|---|
| PENDING_PAYMENT, no proof | Self-cancel | Cancel | none | release |
| PAYMENT_REVIEW / AWAITING_CONFIRMATION / CONFIRMED (before PACKING) | Submit cancellation request | Approve or deny | If payment VERIFIED: refund 100% of amount paid, to the payer's UPI, owner records the transfer reference; if not yet verified, admin resolves the proof first | release |
| PACKING onward | No self-cancel | Exceptional cancel with mandatory reason | Owner decides; refund recorded same way | restore only if goods unopened and admin says so |
| DELIVERY_FAILED | — | Retry delivery or cancel | Owner decides who bears delivery cost | admin choice |
| DELIVERED | No cancellation | — | Returns/replacements outside the system unless you define a policy | — |
Current code lets customers self-cancel up to PACKED; this proposal tightens it. No partial refunds or fees in v1.

**Unpaid order expiry (proposed):** keep the existing 30-minute setting. Only `PENDING_PAYMENT` orders with **no submitted proof** expire (status CANCELLED, actor SYSTEM, stock released once). A rejected attempt restarts the window. A proof for an expired order is refused with "order expired — place a new order; if you already paid, contact the shop with your UTR". Risk: a customer who paid after expiry depends on manual follow-up. Alternative: re-reserve on late proof if stock exists.

**Reviews (proposed):** publish immediately and moderate afterwards; admin may hide only spam/abuse/personal data with a recorded reason; hidden reviews leave the average but stay in admin and audit; star rating alone is never a reason to hide. Alternative: approve-before-publish (current), which gives the owner control but allows cherry-picking.

**Unconfirmed prices/fees:** flagged unapproved; checkout outside local mode stays blocked until confirmed (§3 of requirements).

---

## 7. Test and verification strategy
- **Keep green:** `npm run typecheck`, `npm test`, existing 26 backend tests (SQLite) after every WP.
- **New Postgres suite** (`pytest -m postgres`, needs `BFP_TEST_DATABASE_URL` pointing at the local stack): each test runs in a rolled-back transaction so local data is untouched; skipped, not failed, when the stack is down.
- **SQL security assertions:** `scripts/check-db-security.py` after `supabase db reset`.
- **Storage:** real upload/read/delete against local buckets using a test prefix.
- **Frontend (node):** timeline mapping, idempotency-key persistence, public vs protected routes, multipart review contract, new product/store contracts.
- **End-to-end smoke:** `scripts/smoke-local.py` (sign-up, login, quote, order, PNG proof, admin approve/confirm/pack/ship/deliver, review with photo, rejection+retry) against running local services; test credentials generated into a gitignored file, never printed.
- **Browser check:** in-app browser at 375 / 768 / 1440 px for every changed page, with console errors reviewed.
- No new dependencies planned (Playwright intentionally not added).

## 8. Completion criteria
1. Every P0 item demonstrated fixed on real local Postgres/Auth/Storage.
2. P1 items implemented with their tests; admin nav still four items; no sample data reachable.
3. `check-local-only`, `check-db-security`, typecheck, frontend tests, SQLite and Postgres backend suites, and the smoke script all PASS, with results reported as observed.
4. No remote service contacted; nothing pushed; one local commit per WP.
5. Unconfirmed business data remains visibly flagged; no invented facts in the UI.

## 9. Risks and remaining business questions

**Risks:** `main.py` is 2,700 lines and will grow (new endpoint groups go into small modules only where helper imports stay acyclic; otherwise follow the existing single-router pattern). Local GoTrue token algorithm unknown until WP1. Docker must be started by you. Changing auth flow and customer-cancel rules alters established behaviour, hence the questions.

**Questions (essential only)**
1. **Sign-in UX:** approve the explicit Sign in / Create account design (requirements §7), or keep today's Continue?
2. **Cancellation, refund and expiry:** approve the §6 defaults or give changes (money rules).
3. **Reviews:** publish-then-moderate (recommended) or approve-before-publish?
4. **Isolation and production:** OK to edit `.mcp.json`/`supabase/config.toml` and move the CLI link files (reversible)? And do you want a **production remediation runbook** prepared for later (written only, never executed), since the remote may still hold the insecure migration?
5. **Docker:** please start Docker Desktop (Linux engine) before WP1.

Owner-supplied content still needed before go-live (not blocking local work): approved prices and delivery charge, real UPI/QR and receiving account, ingredient/production/manufacturer/shelf-life/safety facts, store photos, decision on the tracked Excel file.
