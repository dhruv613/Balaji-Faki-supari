# 02 — Admin Business Rules (implemented today)

Only rules with evidence in source code or in a recorded runtime test are listed. Nothing is suggested or invented.

**Columns**: *Where enforced* — **SERVER** (FastAPI, authoritative), **UI** (browser only; a direct API call bypasses it), **BOTH**. *Status* — **IMPLEMENTED** (enforced and exercised), **IMPLEMENTED — not exercised** (code present, not run), **UI-ONLY**, **PARTIAL** (exists but incomplete or has no effect), **UNVERIFIED**. "T:" ids refer to rows in `07_FUNCTIONALITY_STATUS.md`. Source paths: `API` = `backend/app/routes`, `FE` = `admin-panel/src/features/admin`.

Money is stored in **paise** (integers); the API shows rupees (`paise_to_inr`, `inr_to_paise` in `backend/app/core/domain.py`).

---

## 1. Access and authentication

| ID | Rule (exact condition) | Trigger / inputs | If satisfied | If it fails | Role | Source | Status |
|---|---|---|---|---|---|---|---|
| R-AUTH-01 | Admin login works only when `ADMIN_EMAIL` is set, `ADMIN_PASSWORD` has **≥ 10 characters** and `PROOF_SIGNING_SECRET` is set; otherwise the login endpoint answers 503. Email compared case-insensitively and trimmed, password exactly, both with constant-time compare. | `POST /api/admin/login {email, password}`; unknown JSON fields → 422 (`extra=forbid`) | Returns `{token, expiresAt}` (12 h) and ensures an `OWNER_ADMIN` row in `user_profiles` for that email (creates or promotes/reactivates it) | 401 "The admin email or password is incorrect." | none (public endpoint) | `API/admin.py:79`, `core/security.py:admin_login_configured/check_admin_credentials`, `common.py:_ensure_admin_profile` | IMPLEMENTED (T: SEC-LOGIN-*) |
| R-AUTH-02 | **Throttle**: more than 10 failed logins within 15 minutes (counted per server process, in memory) → every further login, **including a correct password**, gets 429 "Too many wrong attempts. Wait 15 minutes". | any failed login | counter list pruned to the last 15 min | 429 | public | `API/admin.py:72-90` (code comment: "counted per serverless instance") | IMPLEMENTED (T: SEC-LOGIN-RATE-LIMIT / -LOCKOUT-AFFECTS-OWNER) |
| R-AUTH-03 | Admin session token = `adm1.` + base64(`{email, exp}`) + HMAC-SHA256 keyed from `ADMIN_EMAIL`, `ADMIN_PASSWORD` and `PROOF_SIGNING_SECRET`; lifetime **12 h**. Changing the password or the secret invalidates all sessions. There is **no server-side revocation**: Log out only deletes the browser copy. | every admin request | token accepted until `exp` | 401 "Your admin session has ended…" | owner | `core/security.py:issue_admin_token/verify_admin_token` | IMPLEMENTED (forged token → 401, T: SEC-FORGED-TOKEN) |
| R-AUTH-04 | Every `/api/admin/*` endpoint (except the photo/QR/proof image URLs and login) requires an authenticated principal with `role == OWNER_ADMIN` and `is_active`. Roles come only from `public.user_profiles`, never from token metadata. Customer tokens → 403. | `Authorization: Bearer …` | request proceeds | 401 (missing/invalid) or 403 (customer) | OWNER_ADMIN | `common.py:get_owner_admin_principal`, `security.py:enforce_owner_admin` | IMPLEMENTED (13 endpoints without a token → 401, T: SEC-NO-TOKEN). The 403 customer path is covered by the project unit tests (`test_admin_route_guard.py`), not by my runtime tests |
| R-AUTH-05 | Image endpoints for admin (`/admin/payments/{id}/proof`, `/admin/reviews/photos/{id}`, `/admin/settings/qr`) accept **either** an HMAC-signed `sig`+`exp` query (TTL: payment proof 300 s, review photo and QR 1800 s) **or** an admin Bearer token. This is why `<img>` tags work without headers. | image request | image bytes, `Cache-Control: private, no-store` | 401/403/404 | owner or holder of a live signed link | `core/storage.py:create/verify_signed_proof_query`, route files | IMPLEMENTED |
| R-AUTH-06 | The admin UI opens only if `GET /api/me` returns `role == OWNER_ADMIN` and `isActive !== false`; browser claims never unlock it. | page load | admin shell | sign-in or "Owner Admin Access Only" screen | — | `FE/components/AdminRouteGuard.tsx:17-52,60-73` | IMPLEMENTED — UI layer (server enforces independently) |
| R-AUTH-07 | A customer Neon Auth user can never be auto-linked to an `OWNER_ADMIN` profile by registering the owner's email; the operator links it manually. | customer token on first request | n/a | 403 "Owner Admin accounts are linked by the store operator…" | customers | `common.py:_ensure_user_profile` | IMPLEMENTED — not exercised (needs Neon Auth; project tests cover it) |

---

## 2. Orders

State machine (`backend/app/core/domain.py:50-63`, duplicated in the browser at `FE/lib/orderStateMachine.ts:33-46`):

```
PENDING_PAYMENT → PAYMENT_REVIEW | CANCELLED
PAYMENT_REVIEW  → AWAITING_CONFIRMATION | PENDING_PAYMENT | CANCELLED
AWAITING_CONFIRMATION → CONFIRMED | CANCELLED
CONFIRMED → PACKING | CANCELLED        PACKING → PACKED | CANCELLED
PACKED → PICKED_UP | CANCELLED         PICKED_UP → SHIPPED | DELIVERY_FAILED
SHIPPED → OUT_FOR_DELIVERY | DELIVERY_FAILED
OUT_FOR_DELIVERY → DELIVERED | DELIVERY_FAILED
DELIVERY_FAILED → OUT_FOR_DELIVERY | CANCELLED
DELIVERED, CANCELLED → (final)
```

| ID | Rule | Trigger / inputs | If satisfied | If it fails | Source | Status |
|---|---|---|---|---|---|---|
| R-ORD-01 | An order may only move along the arrows above; from `CANCELLED` ("locked") or `DELIVERED` ("completed") nothing is allowed. | `PATCH /api/admin/orders/{id}/status {status}` or delivery PATCH | status changes, history row written | 409 with the reason (e.g. "Delivered orders are completed and cannot be transitioned.") | `domain.py:validate_order_transition`, `admin_orders.py:455-462` | IMPLEMENTED (T: API-DELIVERED-LOCKED) |
| R-ORD-02 | Any move to CONFIRMED…DELIVERED requires `payment_status == VERIFIED`. | same | allowed | 409 "…Payment must be VERIFIED first." | `domain.py:149-161` | IMPLEMENTED |
| R-ORD-03 | The statuses `PENDING_PAYMENT`, `PAYMENT_REVIEW`, `AWAITING_CONFIRMATION` cannot be set through the status endpoint; they only change through the payment endpoints. `CONFIRMED` cannot be set through it either (400, "Use POST …/confirm"). | status endpoint | — | 409 / 400 | `admin_orders.py:421-431` | IMPLEMENTED (T: API-PAYMENT-STATES-LOCKED) |
| R-ORD-04 | **Confirm**: order must be in `AWAITING_CONFIRMATION` with payment VERIFIED (calling confirm on an already-CONFIRMED order returns it unchanged). | `POST /api/admin/orders/{id}/confirm {notes?}` (optional `Idempotency-Key`) | see R-ORD-05/06 | 409 "Invalid order transition…" / "cannot be confirmed before its payment is approved" | `admin_orders.py:264-404` | IMPLEMENTED (T: ORD-CONFIRM, API-CONFIRM-UNPAID) |
| R-ORD-05 | On confirm, for each item **with a variant**: `total_stock ≥ quantity` is re-checked under a row lock (else 409 "Insufficient stock to confirm…"); then `total_stock -= qty` and `reserved_stock -= qty` (floored at 0); a `ORDER_DEDUCTED` movement is logged. Typed-amount items (no variant) never touch stock. `orders.stock_deducted = true`. | confirm | stock moves from reserved to sold | 409, nothing changes | `admin_orders.py:294-324` | IMPLEMENTED (T: ORD-CONFIRM: 50 → 49; ORD-CONFIRM-TYPED) |
| R-ORD-06 | Confirm also: sets `status = delivery_status = CONFIRMED`, `confirmed_by/at`, creates the `shipments` row (+ first `delivery_events`) if absent, adds **+1 to `customers.order_count`, `+ order total` to `total_spent_paise`, sets `last_order_at`**, writes status history, audit log and an in-app notification. Default note: "Order confirmed by Owner Admin after payment verification." | confirm | — | — | `admin_orders.py:326-400` | IMPLEMENTED |
| R-ORD-07 | **Cancel** requires a reason of **≥ 5 characters** (UI: dialog textarea; server: 422). Allowed only from PENDING_PAYMENT, PAYMENT_REVIEW, AWAITING_CONFIRMATION, CONFIRMED, PACKING, PACKED and DELIVERY_FAILED. | status endpoint with `CANCELLED` | see R-ORD-08 | 422 / 409 | `admin_orders.py:433-443`, `common.py:_cancel_order` | IMPLEMENTED (T: ORD-CANCEL-*, API-CANCEL-REASON) |
| R-ORD-08 | Cancel side effects: (a) **stock**: unless the previous status was DELIVERY_FAILED, each stocked item returns to stock — `total_stock += qty` if stock had been deducted (confirmed), else `reserved_stock -= qty`; (b) **refund**: if a VERIFIED payment attempt exists a `refunds` row is created once, status PENDING, amount = **full order total (items + delivery charge)**; if payment is VERIFIED but no verified attempt exists → 409; (c) history, audit, notification "Order cancelled. A refund is pending verification." | cancel | — | — | `common.py:357-479` | IMPLEMENTED (T: ORD-CANCEL-UNPAID/-PAID: stock +1, refund PENDING) |
| R-ORD-09 | Cancelling an order that had been **delivery-failed** keeps the already-deducted stock deducted (no return to stock) but still creates the full refund. | cancel from DELIVERY_FAILED | — | — | `common.py:383` | IMPLEMENTED (T: ORD-CANCEL-FROM-FAILED: stock 49 → 49, refund PENDING). Whether this is intended: UNKNOWN / NOT VERIFIED |
| R-ORD-10 | Cancelling does **not** reverse the customer's `order_count`/`total_spent` that confirm added. | cancel after confirm | — | — | `common.py` (no customer update), `admin_orders.py:334-338` | IMPLEMENTED as observed (T: CUST-COUNTERS-AFTER-CANCEL: orders 3→3, spent ₹2,400→₹2,400) |
| R-ORD-11 | **Delivery failure** requires a reason ≥ 5 characters (`failureReason` or notes). Allowed only from PICKED_UP, SHIPPED, OUT_FOR_DELIVERY. Stored on the shipment. | status endpoint or delivery PATCH | status `DELIVERY_FAILED` | 422 | `admin_orders.py:445-453, 597-604` | IMPLEMENTED (T: DEL-FAIL) |
| R-ORD-12 | Moving to DELIVERED sets `shipments.delivered_date` to now when empty; DELIVERED orders become eligible for reviews and are counted by the dashboard. | status/delivery | — | — | `admin_orders.py:479-480, 629-630` | IMPLEMENTED |
| R-ORD-13 | The Orders page offers only transitions the browser state machine allows; "Confirm Order" needs payment VERIFIED; DELIVERY_FAILED is **not** offered on this page; Cancel needs ≥ 5 characters or a warning toast blocks the request. | UI | buttons shown | toast | `FE/lib/orderStateMachine.ts:106-209`, `AdminOrdersPage.tsx:190-221` | UI-ONLY layer on top of R-ORD-01…11 (T: ORD-CANCEL-VALIDATION, ORD-NO-FAIL-ACTION) |
| R-ORD-14 | List query: `status`/`paymentStatus` exact match (`ALL` ignored); `search` = case-insensitive match on order number or shipping name, or substring of phone or PIN; `dateFrom/dateTo` inclusive whole days **in UTC**; `pageSize` 1–200 (UI always asks for 200); newest first. The UI additionally filters the same set client-side (also by "area"). | list | — | 422 for bad dates | `admin_orders.py:203-249`, `AdminOrdersPage.tsx:57-85` | IMPLEMENTED (T: ORD-FILTER-*, ORD-SEARCH-*) |

Context (customer side, determines the data admins see): prices are always read from the database; quantity 1–20; PIN must be in `serviceable_pin_codes` unless that list is empty; delivery fee = store charge unless `subtotal ≥ free_delivery_threshold` (threshold > 0); stock is **reserved** at order creation; order number `#BFP-{1001 + count}`; outside `BFP_ENV=local` ordering is refused until the variant's price is approved and settings are confirmed (`orders.py:87-261`, `common.py:_assert_ordering_open`).

---

## 3. Payments

| ID | Rule | Trigger / inputs | If satisfied | If it fails | Source | Status |
|---|---|---|---|---|---|---|
| R-PAY-01 | Payment attempt states: `PENDING→SUBMITTED→UNDER_REVIEW→VERIFIED` or `REJECTED`; `SUBMITTED→REJECTED` also allowed; `VERIFIED` and `REJECTED` are final for that attempt. | payment endpoints | — | 409 | `domain.py:31-37,164-168` | IMPLEMENTED |
| R-PAY-02 | **Start review** (done silently by the UI before approving): attempt must be SUBMITTED and the order `PAYMENT_REVIEW` with `payment_status SUBMITTED`; calling it when already UNDER_REVIEW returns the record. | `POST /admin/payments/{id}/review` | attempt+order payment → UNDER_REVIEW | 409 | `admin_payments.py:220-269` | IMPLEMENTED (T: PAY-APPROVE) |
| R-PAY-03 | **Approve** requires attempt UNDER_REVIEW, order `PAYMENT_REVIEW` + payment `UNDER_REVIEW`, and a stored screenshot path (not `"pending"`). Result: attempt VERIFIED (+verifier, time, note), order `payment_status = VERIFIED`, `status = AWAITING_CONFIRMATION` — **never** CONFIRMED/PACKING. Approving an already VERIFIED attempt returns it only when an `Idempotency-Key` header is sent, otherwise 409. | `POST /admin/payments/{id}/approve {notes?≤500}` | status history, audit, customer notification | 409 | `admin_payments.py:272-366` | IMPLEMENTED (T: PAY-APPROVE) |
| R-PAY-04 | **Reject / request corrected proof**: reason **5–500 chars**; attempt must be SUBMITTED or UNDER_REVIEW and the order `PAYMENT_REVIEW`. Result: attempt REJECTED (kept as history; `proof_correction_requested` flag), order → `PENDING_PAYMENT` with `payment_status PENDING`, customer notified with the reason. | `POST /admin/payments/{id}/reject {reason, requestCorrectedProof}` | customer may upload a new proof | 422/409 | `admin_payments.py:369-450`, `schemas.py` | IMPLEMENTED (T: PAY-REQUEST-PROOF, PAY-REJECT-VALIDATION) |
| R-PAY-05 | The "Reject" and "Request Corrected Proof" buttons are the same API call; only a flag and the history label differ. | UI | — | — | `AdminPaymentsPage.tsx:155-193` | IMPLEMENTED |
| R-PAY-06 | **No automatic matching.** Approval does not compare the screenshot amount, receiver or UTR with anything; the UTR columns (`submitted_utr`, `verified_utr`) and the `bank_credits` table exist but are not written by any endpoint. The only evidence is the image the owner looks at. | approve | — | — | `admin_payments.py` (no UTR logic); `payments.py` (no UTR input) | IMPLEMENTED as observed (verified by code search) |
| R-PAY-07 | Customer side: proof can be submitted only while order is `PENDING_PAYMENT` and payment `PENDING`; not while another attempt is SUBMITTED/UNDER_REVIEW/VERIFIED; image must be JPEG/PNG/WEBP, ≤ 4 MB, magic bytes must match the declared type. | `POST /api/payments/{order}/submit` | attempt SUBMITTED, order PAYMENT_REVIEW | 409/422 | `payments.py:26-174`, `core/storage.py:validate_*` | IMPLEMENTED (used by the seeding) |
| R-PAY-08 | Dashboard queue = attempts in SUBMITTED or UNDER_REVIEW, oldest first. | dashboard | — | — | `admin.py:179-197` | IMPLEMENTED |

---

## 4. Products, prices and photos

| ID | Rule | Source | Status |
|---|---|---|---|
| R-PRC-01 | Changing a variant's selling price (`new_price != current`) sets `price_confirmed = false`, unless the same request also sends `priceConfirmed`. Clearing price → `null` is allowed. | `admin_catalog.py:159-169` | IMPLEMENTED (T: PRICE-SAVE-RESETS-APPROVAL) |
| R-PRC-02 | `priceConfirmed = true` needs a price (422 "Set a selling price before confirming it."). The UI also blocks it ("Set a selling price before approving it."). | `admin_catalog.py:166-169`, `AdminProductsPage.tsx:64-67` | IMPLEMENTED (BOTH) |
| R-PRC-03 | Cost/selling price must be ≥ 0 (422), UI also parses numbers ≥ 0. Per-kg price must be > 0 and ≤ 1,000,000, per-kg cost 0–1,000,000; per-kg fields are rejected (422) for products not sold by weight (Water). | `admin_catalog.py:135-140,155-165`, `schemas.py` | IMPLEMENTED (T: API-NEGATIVE-PRICE, PRICE-NEGATIVE) |
| R-PRC-04 | A price change affects **future orders only**: order items store `unit_price_paise`/`unit_cost_paise` at purchase time (UI text says so). | `orders.py:198-209`, `AdminProductsPage.tsx:130,222` | IMPLEMENTED |
| R-PRC-05 | A pack can be ordered only if `is_available`, has a price, has enough stock (409 otherwise) and — outside local mode — `price_confirmed` and confirmed store settings. Typed amounts additionally need `price_per_kg` and confirmed settings. | `common.py:_price_line/_assert_ordering_open` | IMPLEMENTED (confirmation gate NOT TESTED: bypassed in local mode) |
| R-PRC-06 | Typed amounts: only for weight products; 100 g – 10 kg in 50 g steps (422 otherwise); price = per-kg price × grams / 1000 rounded half-up to a whole rupee (e.g. 750 g × ₹900/kg = ₹675, verified); cost rounded to the paisa. | `common.py:284-312` | IMPLEMENTED (T: seeded order #BFP-1020 = ₹675) |
| R-PRC-07 | Availability text in the table (UI): `Off sale` if product inactive or pack off; else `Out of stock` if available ≤ 0; else `Awaiting price` if no price; else `Awaiting approval` if not approved; else `On sale`. | `AdminProductsPage.tsx:304` | UI-ONLY label (public rule differs: see R-PRC-08) |
| R-PRC-08 | Public catalogue: a pack with `is_available = false` shows no price and `inStock=false`; a pack with stock 0 keeps its price and `inStock=false`; inactive products are not listed. | `public.py:30-55,107-113` | IMPLEMENTED (T: PRICE-AVAILABILITY) |
| R-PRC-09 | Product photos: max **10** per product; JPEG/PNG/WEBP, ≤ 4 MB, magic-byte check; removing a bundled `/images/…` path does not touch storage. | `admin_catalog.py:315-386` | IMPLEMENTED (T: PRICE-PRODUCT-DETAILS) |
| R-PRC-10 | The API can set `availableQuantity` per variant (`total = qty + reserved`) but the Price Management UI never sends it; stock is changed only through Inventory adjustments. | `admin_catalog.py:170-173` vs `AdminProductsPage.tsx:buildVariantPatch` | PARTIAL (API-only) |
| R-PRC-11 | Product edits are partial: only fields present change; description/information blanks are stored as empty/`NULL` and hidden from customers. | `admin_catalog.py:105-192` | IMPLEMENTED |

---

## 5. Inventory

| ID | Rule | Source | Status |
|---|---|---|---|
| R-INV-01 | `available = max(0, total − reserved)`. | `models.py:251` | IMPLEMENTED |
| R-INV-02 | Manual adjustment: quantity integer 1–100000, reason 5–500 chars; `DEDUCT` greater than **available** → 409 (reserved units cannot be deducted); each adjustment writes an `inventory_movements` row (before/after available, actor, reason) and an audit row. UI mirrors all three checks. | `admin_catalog.py:269-312`, `FE/lib/orderStateMachine.ts:339-367` | IMPLEMENTED (BOTH) (T: INV-OVERDEDUCT, INV-SHORT-REASON, INV-ADJUST-ADD) |
| R-INV-03 | Stock life-cycle: reserved at order creation (movement `RESERVED`), released on cancel (`RELEASED`), deducted from total and reserved on confirm (`ORDER_DEDUCTED`). | `orders.py`, `admin_orders.py`, `common.py` | IMPLEMENTED |
| R-INV-04 | Low-stock alert = `available ≤ variant.low_stock_threshold`. | `admin_catalog.py:204-211` | IMPLEMENTED |
| R-INV-05 | The Settings field "Low-stock alert at (units)" (`store_settings.low_stock_default_threshold`) is saved but **not used** in alert calculations; variant thresholds are 10 from seeding and no endpoint changes them. | `admin.py:515-516` vs `admin_catalog.py:205` | PARTIAL — no effect (T: SET-LOW-STOCK-NO-EFFECT) |
| R-INV-06 | "Stock reservation expiry minutes" only sets `orders.stock_reservation_expires_at` and is displayed; **nothing releases expired reservations** (no job/endpoint). Settings page text agrees: "Orders are never cancelled automatically". | `orders.py:174-192`, grep of `backend/app` | PARTIAL — display only |
| R-INV-07 | The Settings UI has no input for reservation minutes although the API accepts 1–10080. | `AdminSettingsPage.tsx` vs `schemas.py` | PARTIAL (API-only) |

---

## 6. Delivery

| ID | Rule | Source | Status |
|---|---|---|---|
| R-DEL-01 | Delivery transitions (stricter than orders): CONFIRMED→PACKING; PACKING→PACKED; PACKED→PICKED_UP; PICKED_UP→SHIPPED/DELIVERY_FAILED; SHIPPED→OUT_FOR_DELIVERY/DELIVERY_FAILED; OUT_FOR_DELIVERY→DELIVERED/DELIVERY_FAILED; DELIVERY_FAILED→OUT_FOR_DELIVERY. The same move must also pass the order state machine and payment-VERIFIED check. | `domain.py:65-74`, `admin_orders.py:556-607` | IMPLEMENTED (T: DEL-*) |
| R-DEL-02 | A shipment whose order is CANCELLED cannot be updated (409). | `admin_orders.py:575-576` | IMPLEMENTED |
| R-DEL-03 | A delivery status change also sets `orders.status`/`delivery_status` and writes both history tables; a metadata-only save adds a "— Assignment Updated" event and leaves statuses. Metadata fields are free text; an empty string clears a field. | `admin_orders.py:606-681` | IMPLEMENTED (T: DEL-ADVANCE-META, DEL-SAVE-META) |
| R-DEL-04 | `deliveredDate` is auto-filled with the current time on DELIVERED only if empty; the delivery form has no input for it. | `admin_orders.py:629-630` | IMPLEMENTED |
| R-DEL-05 | A shipment exists only after the owner confirms the order (or the first fulfilment status is set); the Delivery list therefore never shows unpaid/unconfirmed orders. | `admin_orders.py:353-370` | IMPLEMENTED |

---

## 7. Customers

| ID | Rule | Source | Status |
|---|---|---|---|
| R-CUS-01 | Customer status: `Pending payment` if any of their orders is PENDING_PAYMENT or PAYMENT_REVIEW; else `Repeat` if `order_count ≥ 2`; `New` if 0; otherwise `Active`. The status filter (new / repeat / pending) is applied after this derivation. | `admin.py:302-314,358-360` | IMPLEMENTED (T: CUST-FILTER-REPEAT) |
| R-CUS-02 | Counters change only on order **confirmation** (R-ORD-06) and never decrease (R-ORD-10). | see above | IMPLEMENTED as observed |
| R-CUS-03 | A customer row is created at their first order; `area` is set to "Rajkot" by the order endpoint (hardcoded). The admin list shows `area`, else the PIN. | `orders.py:144-155,189` | IMPLEMENTED |
| R-CUS-04 | Customer module is read-only: there are no create/update/delete endpoints. | `admin.py:337-415` | IMPLEMENTED |
| R-CUS-05 | Search matches name or e-mail (case-insensitive substring) or phone substring; page size 1–100 (UI: 20). | `admin.py:337-369` | IMPLEMENTED (T: CUST-SEARCH) |

---

## 8. Reviews

| ID | Rule | Source | Status |
|---|---|---|---|
| R-REV-01 | Only the owner of a **DELIVERED** order may review it, once per order; rating 1–5; text 10–2000 chars; ≤ 5 photos, total ≤ 4 MB; published immediately with `is_verified_purchase = true`. | `reviews.py:62-150` | IMPLEMENTED (customer side; used for seeding) |
| R-REV-02 | Admin PATCH needs `moderationStatus` and/or `adminReply`, else 400. **Hiding requires a reason of ≥ 3 chars** (UI forces a category from a list: Spam, Abuse, Private information, Prohibited content; optional detail up to 300 chars). Restoring clears the reason. | `admin.py:245-299`, `AdminReviewsPage.tsx:87-111` | IMPLEMENTED (T: REV-HIDE, REV-HIDE-NEEDS-REASON) |
| R-REV-03 | Hidden reviews are excluded from the public list, public count and average (only PUBLISHED count), but stay in the admin list and in the customer's own admin history. Photos of a non-published review are not served publicly. | `common.py:_review_summary`, `reviews.py:list_published_reviews/get_public_review_photo` | IMPLEMENTED (T: REV-HIDE / REV-UNHIDE: public total 3 → 2 → 3) |
| R-REV-04 | Admin reply ≤ 2000 chars; saving an empty reply clears it; replies are shown publicly (`adminReply` in the public list). | `admin.py:273-276` | IMPLEMENTED (T: REV-REPLY) |
| R-REV-05 | `PENDING_MODERATION` is an accepted status but no code path assigns it (no pre-moderation queue). | `schemas.py`, `reviews.py` | PARTIAL (status unused) |
| R-REV-06 | The "Average Rating" card counts PUBLISHED reviews only; the customer list column "Rating" also averages PUBLISHED only. | `AdminReviewsPage.tsx:76-80`, `admin.py:320-322` | IMPLEMENTED |
| R-REV-07 | The review list API ignores `search`, `rating`, `moderationStatus` params; filters work in the browser. | `admin.py:229-242` | IMPLEMENTED as observed |

---

## 9. Refunds

| ID | Rule | Source | Status |
|---|---|---|---|
| R-REF-01 | A refund exists only when an order with a VERIFIED payment is cancelled; one refund per order; amount = order total; reason = cancellation reason; starts `PENDING`. | `common.py:420-431` | IMPLEMENTED (T: ORD-CANCEL-PAID) |
| R-REF-02 | **Approve**: only `PENDING`, and the original payment attempt must be VERIFIED (409 otherwise); notes ≤ 500; already APPROVED returns the record only with an `Idempotency-Key`, else 409. | `admin_orders.py:729-770` | IMPLEMENTED (T: REF-APPROVE) |
| R-REF-03 | **Record transfer** allowed only from `APPROVED`/`PROCESSING`; `verifiedAmount` must equal the refund amount **exactly in paise** (400); reference 4–128 chars must be unique (409, also enforced by a DB unique index); account 4–128, date 8–32 chars (free text, UI uses a date input). | `admin_orders.py:773-872`, `schemas.py` | IMPLEMENTED (T: REF-DUPLICATE-REF, REF-AMOUNT-MISMATCH) |
| R-REF-04 | Evidence kind: `BANK_TRANSFER` needs the settlement attestation tick (`transferSettlementChecked`) and a reference **not** starting with `TEST-`; `LOCAL_TEST` needs `BFP_ENV=local`, a `TEST-` reference and is stored with notes prefixed "LOCAL TEST EVIDENCE.". The UI offers LOCAL TEST only in non-production builds. | `admin_orders.py:802-818`, `AdminRefundsPage.tsx:486-491` | IMPLEMENTED (T: REF-NEEDS-ATTEST, REF-TEST-REF-AS-BANK, REF-COMPLETE-LOCALTEST) |
| R-REF-05 | Completing a refund notifies the customer in-app and logs `REFUND_COMPLETED`; stock is not touched (already handled at cancel). | `admin_orders.py:849-865` | IMPLEMENTED |
| R-REF-06 | Statuses `PROCESSING`, `FAILED` are accepted by filters/labels but no code ever sets them. | grep | PARTIAL (unused states) |
| R-REF-07 | The UI additionally blocks completion unless status is APPROVED/PROCESSING, reference ≥ 6 chars, account ≥ 4, a parsable date and amount within 0.01 of expected (server stricter on amount, looser on reference length: 4). | `FE/lib/orderStateMachine.ts:282-333` | UI layer |

---

## 10. Settings

| ID | Rule | Source | Status |
|---|---|---|---|
| R-SET-01 | PATCH is partial; at least one field required (400). | `admin.py:465-478` | IMPLEMENTED |
| R-SET-02 | Changing **UPI id, payee name, delivery charge, free-delivery threshold or serviceable PIN list** (when the value actually differs) clears `business_settings_confirmed_at/by`. Uploading a new QR clears it too. Shop text fields do not. | `admin.py:520-550, 634-636` | IMPLEMENTED (T: SET-WITHDRAW, SET-CONFIRM) |
| R-SET-03 | **Confirm** needs: UPI id present and not starting with `local-test`; payee present and not containing "local test"; a QR uploaded; delivery charge not `null`. (An empty PIN list is valid = deliver across India.) Otherwise 422 listing the missing items. The UI disables the button while confirmed or while the UPI id is a LOCAL TEST value. | `admin.py:582-593`, `AdminSettingsPage.tsx` | IMPLEMENTED (T: SET-CONFIRM) |
| R-SET-04 | UPI id must match `^[A-Za-z0-9._-]{2,64}@[A-Za-z][A-Za-z0-9.-]{1,63}$` (or be empty). | `admin.py:418,523-524` | IMPLEMENTED (T: API-UPI-FORMAT) |
| R-SET-05 | PIN codes: unique, each `^[1-9][0-9]{5}$` (max 200 entries). WhatsApp: 10–15 digits (non-digits stripped). Support e-mail: simple `x@y.z` regex or empty. Phone 5–32 chars. Delivery charge 0–100000, threshold 0–10,000,000. | `admin.py:493-546`, `schemas.py` | IMPLEMENTED (T: SET-PIN-VALIDATION, SET-NEGATIVE-DELIVERY) |
| R-SET-06 | QR image ≤ 2 MB; shop photos ≤ 4 MB each, max 20 (409); all JPEG/PNG/WEBP with magic-byte check. | `admin.py:613-724` | IMPLEMENTED (T: SET-PHOTOS) |
| R-SET-07 | Outside `BFP_ENV=local`, new orders are blocked (503 "Ordering is not open yet…") until the owner has confirmed settings and the ordered pack's price is approved. | `common.py:218-226` | IMPLEMENTED — not exercised (local mode bypasses it) |
| R-SET-08 | Shop-profile fields are public via `GET /api/store` immediately after saving (UPI, QR, PIN list, delivery rules stay server-side). | `common.py:_serialize_store_profile` | IMPLEMENTED (T: SET-SAVE) |

---

## 11. Dashboard and audit

| ID | Rule | Source | Status |
|---|---|---|---|
| R-DASH-01 | Population = orders with `status = DELIVERED` **and** `payment_status = VERIFIED`. **Products Sold** = Σ item quantities. | `admin.py:135-139` | IMPLEMENTED (T: ORD-DELIVER) |
| R-DASH-02 | **Net Profit** = Σ `line_total` − Σ `unit_cost × quantity` − Σ(`verified_refund_amount_paise` or refund amount of COMPLETED refunds on those same delivered orders). Delivery charges are excluded. If **any** delivered item lacks `unit_cost_paise` the tile reads "Not configured" and names the products. Refund deduction can never be non-zero in practice because a DELIVERED order cannot be cancelled (INFERRED from R-ORD-01). | `admin.py:141-177` | IMPLEMENTED |
| R-DASH-03 | A "Development data included" note is shown if any sold variant has `price_confirmed = false`. | `admin.py:163-176` | IMPLEMENTED |
| R-DASH-04 | The browser also contains `calculateProductsSold` / `calculateNetProfit` functions (which would subtract delivery charges and use client data) but the Dashboard page does not call them; they are used only by tests. | `FE/lib/orderStateMachine.ts:381-465` | UI code, unused by pages |
| R-AUD-01 | Every admin mutation writes one `admin_audit_logs` row (actor id/email/role, action, module, entity, previous/new JSON, optional idempotency key). No endpoint or page reads this table. | all admin route files | IMPLEMENTED (write-only) |
| R-AUD-02 | Actions by the fixed admin login are attributed to the `user_profiles` row for `ADMIN_EMAIL`. | `common.py:_admin_principal` | IMPLEMENTED |
| R-AUD-03 | Idempotency keys sent by the admin UI are deterministic per resource (e.g. `admin-approve-payment-<id>`), so a repeated approve/confirm/refund-approve is answered with the stored record instead of an error. | `FE/api/index.ts`, route files | IMPLEMENTED — not exercised (no repeated-request test run) |

---

## 12. Items I could not determine

- Whether owner policy requires cancelling delivery-failed orders without returning stock (R-ORD-09) — **UNKNOWN / NOT VERIFIED**.
- Intended behaviour of customer counters after cancellation — **UNKNOWN / NOT VERIFIED**.
- The ordering gate (R-SET-07) behaviour in a non-local environment — **NOT TESTED**.
- Role checks for real Neon Auth customer sessions — only by the repository's unit tests, which pass (110/110 once storage env variables are set; see `07`).
