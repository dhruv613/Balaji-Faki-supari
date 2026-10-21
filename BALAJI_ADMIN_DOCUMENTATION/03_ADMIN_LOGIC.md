# 03 — Admin Logic (what the code actually does)

Describes the **implemented** behaviour only. "FE" = `admin-panel/src/features/admin`, "API" = `backend/app/routes`. A button with no handler or an API that does not exist is said so explicitly.

## 0. Cross-cutting mechanics

### 0.1 Request pipeline
1. Every call goes through `apiFetch` (`admin-panel/src/lib/api.ts:36`):
   - base URL `env.apiBaseUrl` = `VITE_API_BASE_URL` (dev default `http://127.0.0.1:8000/api`; production build default `/api`, which `admin-panel/vercel.json` rewrites to the store deployment `https://balaji-faki-point.vercel.app/api/…`);
   - adds `Accept: application/json`, JSON `Content-Type` (not for `FormData`), and `Authorization: Bearer <token>` read from `sessionStorage["bfp_admin_session"]`;
   - **15-second timeout** (`AbortSignal.timeout(15_000)`); network failure → `ApiError(0, "Cannot reach the Balaji Faki Point server…")`;
   - non-2xx → `ApiError(status, detail)` where FastAPI's `detail` (string or list of validation messages joined with " · ") is shown to the user; unreadable body → "The server returned an unreadable response."
2. `FE/api/index.ts` wraps each endpoint; `buildQueryString` drops empty and `ALL` values; mutating calls for payment review/approve, order confirm, refund approve / record-transfer add an `Idempotency-Key` header derived from the resource id.
3. The API client never fabricates success: when `apiBaseUrl` is empty pages show "Server not connected / Integration pending" and block mutations (not reachable in dev/prod builds because `apiBaseUrl` always has a default).

### 0.2 Error handling pattern
- Loads: page state `loading` → skeleton; failure → `ErrorState`/`Notice tone="error"` with the message (some with **Retry request**). Mutations: failures appear as a toast (orders, prices, delivery, reviews, inventory success) or an inline red notice inside the drawer (payments, refunds, inventory form). No global error boundary was found.
- All "unavailable" copy such as "Connect the local FastAPI server…" is displayed only while no successful load has happened (`isLive` false), including during the initial load.

### 0.3 State and persistence
- No global store, no router loaders: each page owns `useState` and fetches on mount/filter change (`useEffect`). Data is **not cached**; leaving and re-entering a page reloads it. `notifyAdminDataChanged()` dispatches a `window` event after order/price/stock changes but **no component subscribes**, so pages do not refresh each other.
- Every change is saved by the backend before the UI updates (the UI replaces its row with the server response). After a browser refresh the data is the database state — verified for every mutation in `07_FUNCTIONALITY_STATUS.md`.
- Only session state is browser-local: the admin token (tab-scoped `sessionStorage`). No `localStorage` use.

### 0.4 Backend structure
- `backend/app/main.py` mounts one router under `/api` and again at `/` (both resolve). Admin modules: `admin.py` (login, dashboard, reviews, customers, settings), `admin_orders.py` (orders, deliveries, refunds), `admin_payments.py`, `admin_catalog.py` (products, images, inventory). Each admin handler depends on `get_owner_admin_principal`.
- Mutations use a SQLAlchemy session with `SELECT … FOR UPDATE` row locks (`with_for_update()`), write domain rows + `order_status_history`/`delivery_events`/`inventory_movements` + `admin_audit_logs` (+ `notifications` where noted) and `commit()` once. On commit failure image uploads are rolled back from storage.
- Storage (payment screenshots, QR, product/shop photos, review photos) is S3-compatible Neon Object Storage through one function, `core/storage._storage_request`.

### 0.5 Effect on the customer storefront
The two apps share the same API and database; there is no message bus. The storefront reads: products/prices/stock (`GET /api/products`), shop profile (`GET /api/store`), published reviews (`GET /api/reviews`), and the customer's own order, payment status and tracking (`GET /api/orders/*`, `/api/payments/*/status`). Therefore every admin change below is visible to customers on their next request. Verified via the public API only (the storefront UI itself was not used).

---

## 1. Sign-in and session

| Step | What happens | Function |
|---|---|---|
| Open any `/admin/*` | `AdminLayout` renders `AdminRouteGuard`. `useSession()` subscribes to the auth store (`lib/auth.ts`) which calls `refreshSession()` once: with no token → signed out. | `AdminRouteGuard`, `auth.ts:subscribe/refreshSession` |
| Sign in click | Client check both fields filled → `signIn()` → `POST /api/admin/login` → on 200 `storeToken(token)` (memory + sessionStorage) → `refreshSession()` → `GET /api/me` → session published → guard's effect calls `getAdminMe()` again (second `/api/me`) → `serverRole` set. | `AdminSignIn.submit`, `auth.signIn` |
| Allowed | `evaluateAdminRouteAccess` → `AUTHORIZED_ADMIN` only if `serverRole === 'OWNER_ADMIN'`; renders `<Outlet>` with sidebar/header. URL stays as typed; `/admin` itself then redirects to `dashboard` through the index `Navigate` route. | `AdminRouteGuard.tsx` |
| Failure paths | 401 wrong credentials → red notice; 429 → "Too many wrong attempts…"; 503 → "not set up on the server yet". `/api/me` 401/403 → token cleared; `/api/me` 5xx/network → no session, plain sign-in card, token kept. A session whose guard call later fails → "Owner Admin Access Only" + **Try again** (re-runs the guard effect). | `auth.refreshSession` |
| Log out | `signOut()` clears memory + sessionStorage and publishes "signed out". **No request is made**; the signed token keeps working until its 12-hour expiry if somebody copied it. | `auth.signOut` |
| Expiry | Not proactive: the next API call returns 401 "Your admin session has ended…" which pages display as an error; the guard only re-checks on mount. A forged token on reload → `/api/me` 401 → cleared → sign-in (tested). | — |

Backend (`POST /api/admin/login`): config check → prune failures older than 15 min → if ≥ 10 recent failures → 429 → `check_admin_credentials` → on failure push timestamp, 401 → `_ensure_admin_profile` (create/promote `OWNER_ADMIN` profile) → `issue_admin_token`. Table touched: `user_profiles`.

---

## 2. Shell controls

- **Sidebar open/close** — local state in `AdminLayout`; opening via ☰ (≤ 1024 px), closing via ✕, backdrop, any nav click, or any route change.
- **Header search** — submit → `navigate('/admin/orders?q=…')`. `AdminOrdersPage` reads the query string **once** (`useState(initialQueryParam)`), therefore on an already open Orders page the displayed list does not follow the new `?q=` (verified).
- **Profile modal save** — validate → `updateProfile()` → `PATCH /api/me {fullName, phone:"+91…"}` → server updates `user_profiles` (and the linked `customers` row if any) → `setProfile` updates the sidebar/header name without reload. Tables: `user_profiles`, `customers`.
- **Store / Customer Store links** — plain `<a href=VITE_STORE_URL>`; hidden when the variable is empty.
- **"Log out" button inside the profile modal** — `signOut()` then modal closes. A `window.alert` fallback exists for a thrown error (never reached in practice).

---

## 3. Dashboard

`AdminDashboardPage` → on mount `GET /api/admin/dashboard` → `get_admin_dashboard`:
1. `SELECT orders WHERE status='DELIVERED' AND payment_status='VERIFIED'`; flatten items; `productsSold = Σ quantity`.
2. If any item has `unit_cost_paise IS NULL` → `netProfit = {amount:null, status:'NOT_CONFIGURED', reason:'Cost price is not configured for: …'}`; else `revenue − cost − refunds` (COMPLETED refunds of these orders) in paise → rupees; `note` set when any sold variant has `price_confirmed=false`.
3. `SELECT payment_attempts WHERE status IN (SUBMITTED, UNDER_REVIEW) ORDER BY submitted_at` → rows.
The page renders tiles/table. **Review** is a router `<Link>` (no API call) to `/admin/payments?payment=<id>`. Refresh = reload from DB. Not refreshed automatically after other pages' actions.
Tables read: `orders`, `order_items`, `product_variants`, `refunds`, `payment_attempts`.

---

## 4. Orders

**Load**: `useEffect([query,statusFilter,paymentFilter,dateFrom,dateTo])` → `GET /api/admin/orders?…&pageSize=200` → `list_admin_orders` builds a `SELECT` with filters, counts, orders by `created_at desc`, serialises every order with items, payment details and timeline in the same response (`_serialize_admin_order_detail`). Typing in the search box fires a request **per keystroke** (no debounce).

**Click "View Order"** → `setSelectedOrder(order)` (data already loaded; no request). **"View payment screenshot"** link → router navigation to `/admin/payments?payment=<id>`.

**Click an action button** (e.g. *Confirm Order*):
1. `initiateOrderTransition` → client `validateOrderTransition`; refused → error toast; else `setPendingAction` opens `ConfirmDialog` (notes textarea reset).
2. Confirm → `executeOrderAction`: re-validates; Cancel/Delivery-failed need ≥ 5 chars (toast otherwise); then
   - CONFIRMED → `POST /api/admin/orders/{id}/confirm {notes}` + `Idempotency-Key`;
   - others → `PATCH /api/admin/orders/{id}/status {status, notes, cancellationReason?, failureReason?}`.
3. Server `confirm_admin_order`: resolve order by id or `#BFP-n`, `SELECT … FOR UPDATE`; already CONFIRMED → return; `validate_order_transition`; payment VERIFIED; for each stocked item lock variant, check `total_stock`, decrement `total_stock` and `reserved_stock`, add `InventoryMovement ORDER_DEDUCTED`; set `CONFIRMED`, `stock_deducted`, `confirmed_by/at`; increment the customer's `order_count`, `total_spent_paise`, `last_order_at`; add `OrderStatusHistory`; create `Shipment`+`DeliveryEvent` if none; `AdminAuditLog ORDER_CONFIRMED`; `Notification ORDER_CONFIRMED`; commit.
   `update_admin_order_status`: rejects CONFIRMED (400) and payment states (409); **CANCELLED** → `_cancel_order` (stock return unless previous DELIVERY_FAILED, refund row if a VERIFIED attempt exists, history/audit/notification); **fulfilment statuses** → validate transition, set `orders.status` and `delivery_status`, create/update `Shipment`, add `DeliveryEvent` and `OrderStatusHistory`, `AdminAuditLog ORDER_STATUS_<X>`.
4. UI on success: replace the row, **open the drawer for that order**, `notifyAdminDataChanged()`, success toast, close dialog. On error: error toast, dialog stays open.
Tables written: `orders`, `order_status_history`, `shipments`, `delivery_events`, `product_variants`, `inventory_movements`, `customers`, `refunds`, `notifications`, `admin_audit_logs`.
Customer effect: the order's status/timeline (`GET /api/orders/{id}/tracking`) and the customer's cancel eligibility change; a cancelled paid order shows a pending refund on the customer's side only through status text.

---

## 5. Payments

**Load**: `GET /api/admin/payments?search&status` (server ignores paging) → each row includes a fresh 5-minute HMAC-signed proof URL (`signedScreenshotUrl`), so listing 15 payments generates 15 signatures.
**Open row** (`openPaymentInspector`): set drawer data, clear notes, prefill rejection reason with an existing one; if `signedScreenshotUrl` is empty it calls `GET …/proof` for a new link (normally not needed). A `?payment=<id>` in the URL opens the matching row after the **first** load only.
**Image**: `<img src=resolveApiUrl(signedUrl)>` → `GET /api/admin/payments/{id}/proof?sig&exp&raw=1` → signature verified → `read_private_payment_proof` → bytes.
**Approve click** (`handleApprovePayment`): refuses if `signedScreenshotUrl` is missing; if payment is SUBMITTED → `POST …/review` (UNDER_REVIEW); then `POST …/approve {notes}`; on success replaces the row, shows toast "Payment for … approved. Order moved to AWAITING_CONFIRMATION." If the second call fails the first stays applied (payment UNDER_REVIEW) — consistent with the UI treating SUBMITTED and UNDER_REVIEW the same.
Server writes: `payment_attempts` (status, verifier, notes), `orders` (payment_status, status), `order_status_history`, `admin_audit_logs`, `notifications`.
**Reject / Request corrected proof**: reason < 5 chars → inline "Action blocked" notice; else `POST …/reject {reason, requestCorrectedProof}` → attempt REJECTED, order → PENDING_PAYMENT, payment PENDING, history, audit, notification with the reason. The customer endpoint `GET /api/payments/{id}/status` then returns `rejectionReason` and `canSubmitProof: true`.
Stats cards are recomputed from the in-memory list (so they stay correct after an action).

---

## 6. Price Management

**Load**: `GET /api/admin/products` (`cache: 'no-store'`) → all products (including inactive) with variants sorted by weight/volume.
**Row edit**: `startRowEdit` copies cost/price/availability/approval into `row` state (only one row at a time). Typing a price sets `approve=false`. **Save** → `buildVariantPatch` compares with the stored variant and builds `{packSize, costPrice?, price?, isAvailable?, priceConfirmed?}`; nothing changed → toast "Nothing changed."; else `PATCH /api/admin/products/{id} {variants:[patch]}`.
Server `update_admin_product`: find product by id or slug; find variant by id or pack size (404 otherwise); apply cost/price (resets `price_confirmed` when the price differs), explicit `priceConfirmed`, `availableQuantity` (never sent by this page), `isAvailable`; write `AdminAuditLog PRODUCT_PRICES_UPDATED` with previous state and the request body; commit; return the product. UI replaces the product in state and shows "Saved … Price changes apply to future orders only."
**Per-kg row**: `PATCH {pricePerKg, costPerKg}` (`null` switches typed amounts off); server rejects non-weight products with 422.
**Details drawer**: form → only changed fields → `PATCH` (name, nameGu, category, description, active, information fields); empty information strings become `NULL`. **Upload photo**: client checks MIME then `POST …/images` multipart (`image`, `altText`) → validate bytes/size → `put_storage_object(product-images/<slug>/<uuid>.ext)` → `product_images` row at first free position → audit → commit (storage object deleted if the commit fails). **Remove** → `DELETE …/images/{id}` → row deleted, commit, object deleted (only for non-bundled paths).
Customer effect: `GET /api/products` reads the same rows — price, `priceConfirmed`, `inStock`, `pricePerKg`, description, information and gallery changed immediately (verified).

---

## 7. Inventory

**Load**: `GET /api/admin/inventory` → every variant (`ORDER BY product.slug, pack_size`) + 100 latest movements + summary sums. **Adjust**: client `validateStockAdjustment` → `POST …/adjustments {inventoryItemId, adjustmentType, quantity, reason}` (only these four fields are sent because the server forbids extra fields) → server locks the variant, computes `previous_available`, checks DEDUCT ≤ available (409), updates `total_stock`, inserts `InventoryMovement MANUAL_ADD/MANUAL_DEDUCT`, audit, commit, returns the movement. UI closes the drawer, toasts, **re-fetches the whole inventory**; if that refetch fails it shows "Stock was saved, but updated inventory could not be loaded."
Customer effect: `availableStock` drives `inStock` and the order-time stock check.

---

## 8. Delivery

**Load**: `GET /api/admin/deliveries?status&search` (server filter on status; search filter in Python over order #, customer, address, rider) ordered by `shipments.updated_at desc`.
**Manage / next-stage button** → `openDeliveryDrawer` copies metadata into the form.
**Stage button** → `validateDeliveryTransition` → failure needs reason ≥ 5 → `PATCH /api/admin/deliveries/{id} {status, …all metadata fields currently typed…, failureReason?}`. Server (`update_admin_delivery`): shipment found by id or order id; order locked; CANCELLED → 409; if the status changed: shipment transition check, order transition check (+payment VERIFIED), failure reason; apply metadata (empty → `NULL`); set shipment and order status; `DeliveryEvent`, `OrderStatusHistory`; audit `DELIVERY_STATUS_<X>`; commit.
**Save Delivery Metadata** (form submit) → same PATCH without `status` and without `failureReason` → metadata saved, an "— Assignment Updated" event appended, audit `DELIVERY_ASSIGNMENT_SAVED`.
The "Delivered" metadata date is not a form field (see F-61).

---

## 9. Customers

`GET /api/admin/customers?search&status&page&pageSize=20` after a 250 ms debounce (per keystroke). Backend loads all customers matching search/area, serialises each (rating average + pending-order count queries), filters by derived status, slices. Detail: **View** → `getAdminCustomerById` (the drawer first shows list data with empty orders/reviews, then the full record when the request returns). No write endpoints exist.

---

## 10. Feedback / reviews

`GET /api/admin/reviews` → all reviews newest first with signed 30-minute photo paths; filtering in the browser. **Save Admin Reply** → `PATCH …/reviews/{id} {adminReply}` (only the reply, so visibility never changes). **Hide** → `PATCH {moderationStatus:'HIDDEN', moderationReason:"<category>: <detail>"}`; **Make Public Again** → `PATCH {moderationStatus:'PUBLISHED'}`. Server locks the review, updates fields, sets `moderated_by`, writes `AdminAuditLog REVIEW_MODERATED` with before/after JSON. Customer effect: `GET /api/reviews` and per-product averages change at once (verified); the review's photos stop being publicly served while HIDDEN.

---

## 11. Refunds

`GET /api/admin/refunds?status` → refund rows joined with order (customer, phone, who cancelled: ADMIN if the canceller's profile is OWNER_ADMIN, else CUSTOMER — returned by the API but **not displayed**). **Process Refund** opens the drawer with a prefilled date (today), amount (refund amount), evidence "Real bank transfer". **Approve** → `POST …/approve {notes}`. **Verify & Mark COMPLETED** → UI checks (evidence rules, `validateRefundCompletion`) → `POST …/record-transfer` with `evidenceKind`, attestation flag, amount, reference, account, date, notes → server checks (R-REF-03/04), stores `verified_refund_amount_paise`, `verified_by/at`, reference, bank account, date, notes; `AdminAuditLog REFUND_COMPLETED`; `Notification REFUND_COMPLETED`. Unique-index violation after the pre-check → 409 "already recorded". No customer money movement happens.

---

## 12. Settings

**Load**: `GET /api/admin/settings` → `_serialize_admin_settings` (profile fields + payment/QR signed link + delivery rules + confirmation state + `paymentIsLocalTest`). The page renders nothing editable until this succeeds.
**Save**: `changedSettings(current, form)` → only changed fields; PIN parsing/number validation errors show in the banner; empty patch → info toast. `PATCH /api/admin/settings` → partial update with the validation in R-SET-*, `store.updated_by = admin`, previous/after JSON audit (QR URL removed from the log), commit; the response replaces page state (`apply`).
**QR upload**: file type check → `POST …/qr` multipart → validate (≤ 2 MB) → new object `payment-qr/qr/<uuid>.ext` → update path, withdraw confirmation, audit `PAYMENT_QR_REPLACED` → commit → old object deleted. **Confirm** → (working-tree version) if unsaved changes exist: banner "Save your changes before confirming…"; else `POST …/confirm {confirm:true}` → conditions R-SET-03 → set `business_settings_confirmed_at/by` + audit `BUSINESS_SETTINGS_CONFIRMED`.
**Photos**: add/remove immediately via `POST/DELETE …/photos`; unsaved text edits are preserved across these refreshes by `applyMediaUpdate` (a working-tree addition).
Customer effect: `GET /api/store` shows shop fields; the order endpoint reads delivery charge/threshold/PIN list/UPI/QR at order time.

---

## 13. Things that look like features but are not wired

| Item | Evidence |
|---|---|
| `/admin/reports`, `/admin/notifications` pages | `App.tsx:36-37` `Navigate` redirects; no backend routes (404 in test `API-REPORTS-NOTIFICATIONS-MISSING`) |
| `notifyAdminDataChanged` / `subscribeAdminDataChanged` | dispatched after order, price, stock changes; the only subscriber is none in `src/` (grep) |
| `calculateProductsSold`, `calculateNetProfit` (browser) | not called by any page; the dashboard uses the server numbers |
| Refund `PROCESSING`/`FAILED` statuses, `ADMIN`/`CUSTOMER` canceller display, review `PENDING_MODERATION` | defined in types/labels/filters, never produced or shown |
| Notification and audit-log tables | written by many handlers, never read by an API |
| `StatCard` `to=` prop, sidebar `badge` prop | supported by components; no caller passes them |
| UTR / `bank_credits` | schema columns only |
| Reservation expiry (`stock_reservation_expiry_minutes`) | stored and displayed; no job releases stock |
| Low-stock threshold setting | saved; not used by alerts |
