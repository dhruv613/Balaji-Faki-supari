# 01 — Admin Features (as currently built)

Snapshot of the **Balaji Faki Point Owner Admin Panel** (`admin-panel/`). Everything below was read from source and, where marked, exercised in a running local copy. Nothing here is a recommendation.

How to read this file
- **Source** paths are relative to the repository root. `FE` = `admin-panel/src/features/admin`, `API` = `backend/app/routes`.
- **Data kind** uses: **REAL** (read from / written to the database through the FastAPI backend), **LOCAL STATE** (kept only in React state), **HARDCODED** (literal in the code), **MOCK** (sample data in code, not wired to a route).
- **Works?** is taken from `07_FUNCTIONALITY_STATUS.md` (tested in a local isolated copy). It is not a claim about the live deployment.
- Screenshot file names are in `screenshots/desktop|mobile|interactions/`; `__mobile` suffix = 390 × 844 version. Full list: `08_SCREENSHOT_INDEX.md`.
- IDs `F-xx` are referenced by the other documents.

## 0. Inventory of what exists

| Item | Count | Detail |
|---|---|---|
| Routes registered under `/admin` | 14 | `dashboard`, `prices`, `products`, `orders`, `feedback`, `reviews`, `payments`, `inventory`, `delivery`, `customers`, `refunds`, `settings` (render a page) + `reports`, `notifications` (redirect to dashboard) — `admin-panel/src/app/App.tsx:20-38` |
| Distinct working admin pages | **10** | Dashboard · Price Management (`/prices` = `/products`) · Order Management · Payment Screenshots · Inventory · Delivery · Customers · Feedback Management (`/feedback` = `/reviews`) · Refunds · Settings |
| Page components that exist but are unreachable | 2 | `AdminReportsPage.tsx`, `AdminNotificationsPage.tsx` (routes redirect; backend has no `/admin/reports` or `/admin/notifications`) |
| Gate screens (not routes) | 3 | Sign-in card, "Owner Admin Access Only" denial, "Verifying…" splash — all rendered by `AdminRouteGuard` |
| Sidebar links | 5 | Dashboard, Price Management, Order Management, Feedback Management, Settings (`AdminSidebar.tsx:16-27`) |
| Pages with **no link from anywhere in the UI** | 3 | **Delivery**, **Customers**, **Refunds** (grep of all `to=`/`Link` targets; reachable only by typing the URL). Payments is reached from Dashboard "Review" and the order drawer; Inventory from Price Management "Manage stock". |

Features documented: **37** — shell/access/shared UI `F-01…F-07`, then per-page features `F-10…F-112` (grouped A–L below).

---

## A. Shell, access and shared UI

### F-01 Admin sign-in
- **Route**: any `/admin/*` while signed out (URL stays as typed; e.g. `/admin`). Component `FE/components/AdminSignIn.tsx` inside `AdminRouteGuard.tsx`.
- **Purpose (per code)**: "The Admin Panel's one fixed login" — one email + password that the backend compares with `ADMIN_EMAIL` / `ADMIN_PASSWORD` environment variables.
- **View**: logo, "Admin Console" badge, "Admin Sign In" heading, explanatory line, form, "← Return to Customer Store" link (only if `VITE_STORE_URL` is set; in dev it defaults to `http://localhost:5173`).
- **Actions / controls**: Admin email (type=email, max 254), Password (max 200), "Show password" checkbox, **Sign in** button.
- **Validation**: client — both fields non-empty ("Enter the admin email and password."). Server — email+password compare (`hmac.compare_digest`); wrong → 401 "The admin email or password is incorrect."; not configured → 503; **429** after 10 failures in 15 min per server process.
- **Backend**: `POST /api/admin/login` → `API/admin.py:79 admin_login`; returns `{token, expiresAt}` (12 h).
- **After action**: token stored in `sessionStorage["bfp_admin_session"]` (per tab), `GET /api/me` fetched, admin shell rendered.
- **Data**: REAL. **Works?** Yes (T: AUTH-*, SEC-LOGIN-*). **Source**: `FE/components/AdminSignIn.tsx`, `src/lib/auth.ts`, `API/admin.py`, `backend/app/core/security.py`.
- **Screenshots**: `login__empty-form`, `login__validation-empty`, `login__wrong-password` (desktop + mobile).

### F-02 Route guard / role verification
- **Purpose**: decide whether the admin UI may open. Source of truth is the server: `GET /api/me` must return `role == OWNER_ADMIN` (`AdminRouteGuard.tsx:17-52`).
- **States rendered** (all captured): *Verifying Owner Admin authorization…* splash; sign-in card; **DENIED_UNVERIFIED** ("Owner Admin Access Only" + **Try again**) when the role call fails after a session exists; **DENIED_CUSTOMER** ("Owner Admin role required" notice) when `/api/me` returns another role.
- **Buttons**: Try again, Log out, ← Return to Customer Store.
- **Backend**: `GET /api/me` → `API/account.py:get_me`.
- **Persistence**: token survives reload in the same tab (sessionStorage); closing the tab signs out. A 401/403 from `/api/me` clears it; a 500/network error leaves the sign-in card showing with the token kept.
- **Data**: REAL. **Works?** Yes for sign-in/out/tamper; the CUSTOMER-role screen can only be reached with a browser-side stubbed `/api/me` because the fixed admin login always yields OWNER_ADMIN (simulated in test, flagged as such).
- **Screenshots**: `guard__role-check-failed`, `guard__customer-role-denied`, `guard__me-fails-on-load-shows-signin` (+ `__mobile`), `auth__after-logout`.

### F-03 Sidebar navigation
- **Control list**: logo link (→ dashboard), 5 nav links, user card (name/email/phone), **← Customer Store**, **Log out**; on ≤1024 px a ✕ close button and a backdrop.
- **Behaviour**: active link highlighted by `NavLink`; sidebar closes on any route change (`AdminLayout.tsx`); `ADMIN_NAV_GROUPS` has one group "Admin Navigation". `badge` support exists in code but no item uses it.
- **Data**: user card from `useSession()` (REAL, from `/api/me`); links HARDCODED. **Works?** Yes. **Source**: `FE/components/AdminSidebar.tsx`. **Screenshots**: every page screenshot; `shell__sidebar-open__mobile`.

### F-04 Header global search
- **Control**: search input "Search Order #BFP-1042, customer, or phone…" (`aria-label="Global admin search"`). Enter → `navigate('/admin/orders?q=<text>')` (`AdminHeader.tsx:50-55`). Empty input does nothing.
- **Behaviour verified**: works when starting from another page. **When already on `/admin/orders` the URL changes but the page keeps its first search text** — `AdminOrdersPage` reads `?q=` only once at mount (`useState(initialQueryParam)`), so the list does not update (T: HDR-SEARCH-SAMEPAGE, BROKEN).
- **Searches**: orders only (order number, name, phone, PIN). Placeholder text mentions "customer, or phone", not other modules.
- **Screenshots**: `header__global-search-result`, `header__global-search-same-page`.

### F-05 Header profile pill + "Admin Profile & Account" modal
- **Controls**: pill (initials, name, email) → modal with Full Name (max 100), Mobile Number (+91, 10 digits, digits-only filter), **Save Profile**, **Settings** link, **← Go to Customer Store**, **Log out**, ✕.
- **Validation**: client `validateCustomerDetails` (name ≥ 2 chars; mobile `^[6-9]\d{9}$`) → inline error. Server `PATCH /api/me` also validates (name ≥ 2, phone normalised to `+91…`).
- **After save**: "Profile saved to database ✅"; session user updated (`setProfile`). Modal closes via ✕ or backdrop click only (no Escape handler).
- **Backend**: `PATCH /api/me` → `API/account.py:update_me` (updates `user_profiles`, and `customers` if a row is linked to that user).
- **Data**: REAL. **Works?** Yes. **Screenshots**: `header__profile-modal(-validation|-saved|-mobile)`.

### F-06 Header "Store" button and logout
- **Store**: link to `VITE_STORE_URL` (hidden when empty; dev default `http://localhost:5173`). Leaves the admin site.
- **Log out** (header, sidebar, profile modal, guard screens): clears the token (`signOut`), shows sign-in. No server call (the token is a stateless signed value; it stays valid until it expires — see `03_ADMIN_LOGIC.md`).

### F-07 Shared feedback components
`Toast` (4.5 s auto-dismiss, ✕), `ConfirmDialog` (Escape/backdrop cancel unless busy), `DetailDrawer` (Escape/backdrop/Close), `ImagePreview` (click to enlarge), `StatusBadge`, `StatCard`, `AdminTimeline`, `LoadingSkeleton`, `EmptyState`, `ErrorState` (with "Retry request" where wired), `Notice`. Visuals in `05_ADMIN_UI_UX.md`.

---

## B. Dashboard — `/admin/dashboard`

Source: `FE/pages/AdminDashboardPage.tsx` · API `GET /api/admin/dashboard` (`API/admin.py:129 get_admin_dashboard`).
Screenshots: `dashboard__empty-state`, `dashboard__populated`, `dashboard__loading-skeleton`, `dashboard__error-network`, `dashboard__review-link-opens-payment-drawer`, `dashboard__after-workflows` (mobile).

### F-10 "Products Sold" tile
- Shows **units** (sum of `order_items.quantity`) for orders with `status = DELIVERED` **and** `payment_status = VERIFIED`. Real data. No date range, no drill-down. Works: yes (8 after the test delivered 2 more units).

### F-11 "Net Profit" tile
- Shows `₹amount` or **"Not configured"**. Formula (server): Σ item `line_total` − Σ (`unit_cost × quantity`) − Σ completed refunds **of those delivered orders**. Delivery charges are excluded ("pass-through"). If any delivered item has no `unit_cost_paise` the server returns `NOT_CONFIGURED` with a reason listing the products. A yellow notice "Development data included" appears when any sold variant has `price_confirmed = false`.
- Real data. Works: yes (₹1,950 → ₹2,210 after one more delivery in testing).

### F-12 "Pending Payment Confirmations" table
- Columns: Order, Customer, Amount, Submitted, Status, (Review button). Rows = payment attempts with status SUBMITTED or UNDER_REVIEW, oldest first. Empty → "Nothing waiting".
- **Review** → `/admin/payments?payment=<paymentId>` which auto-opens the payment drawer (F-31).
- Loading: skeleton; error: `ErrorState` with **Retry request**. No pagination, search or sorting.

---

## C. Order Management — `/admin/orders`

Source: `FE/pages/AdminOrdersPage.tsx`, `FE/lib/orderStateMachine.ts` · API `API/admin_orders.py` (`GET /api/admin/orders`, `POST …/{id}/confirm`, `PATCH …/{id}/status`).

### F-20 Orders list, search and filters
- **Table columns**: Order ID · Customer (name + phone) · Product (product + pack) · Quantity ("N pack(s)" = Σ item quantities) · Total Amount · Payment Status badge · Order Status badge · Order Date · Action buttons.
- **Controls**: search input (order #, customer name, phone digits, PIN — server filter `search`, then re-filtered client-side incl. "area"); Order Status select (12 values + All); Payment Status select (5 + All); From Date / To Date (`type=date`).
- **Query**: each change calls `GET /api/admin/orders?search&status&paymentStatus&dateFrom&dateTo&pageSize=200`. Initial values can come from `?q=` / `?orderId=` / `?status=`.
- **"Pagination"**: none. Footer text "Showing 1–N of N matching orders" is computed from the loaded list; `pageSize` is fixed at 200, so more than 200 orders would be silently cut off (UNKNOWN whether the owner will reach that volume).
- **Empty**: "No orders match the current search and status filters." Loading: skeleton. Error: "Orders request failed" notice with the server detail.
- Data REAL. Works: yes. Screenshots: `orders__empty-state`, `orders__populated`, `orders__filter-status-confirmed`, `orders__filter-payment-submitted`, `orders__search-customer-name`, `orders__search-no-results`, `orders__filter-date-future`, `orders__error-500`.

### F-21 Order detail drawer ("View Order")
- **Shows**: customer name, phone, email, PIN, full address, customer notes (if any), ordered items (image, name EN+GU, pack/amount, "weigh to order" tag for typed amounts, quantity, unit price, line total), subtotal / delivery charges / total, payment status + link "View payment screenshot", and **Immutable Order Timeline** (status history; timestamps are shown as raw ISO strings).
- **Warning**: when payment is not VERIFIED a notice says the order cannot be confirmed or packed until the payment is approved (link to dashboard queue).
- **Footer**: Close + the same transition buttons as the row.
- Screenshots: `orders__drawer-delivered`, `orders__drawer-payment-review-warning`, `orders__drawer-cancelled-refunded`, `orders__drawer-typed-amount`, `orders__drawer-mobile`.

### F-22 Order status actions
- **Buttons offered per order** are computed by the client state machine (`getAllowedOrderActions`): Confirm Order (primary) · Start Packing · Mark Packed · Mark Picked Up · Mark Shipped · Mark Out for Delivery · Mark Delivered (primary) · **Cancel Order** (danger). **No "Delivery failed" button exists on this page** (the action map `ORDER_ACTION_LABELS` has no entry) — delivery failure can only be recorded on the Delivery page (F-61).
- **Flow**: click → `ConfirmDialog` with a notes textarea ("Admin Audit Notes (Optional)"; **required ≥ 5 characters** for Cancel) → confirm → `POST …/confirm` (for CONFIRMED, with header `Idempotency-Key: admin-confirm-order-<id>`) or `PATCH …/status`.
- **After success**: row replaced with the server's response, toast "Order #… updated to <label>.", **the order drawer opens** for that order, a window event `bfp:admin-data-changed` is dispatched (no listener found in the pages).
- **Server effects** (verified): confirm deducts stock and creates the shipment + customer counters; cancel returns stock and creates a PENDING refund when payment was VERIFIED; every action writes status history and an audit-log row; confirm/cancel/payment/refund actions also write an in-app `notifications` row (not viewable anywhere in the admin).
- Data REAL. Works: yes. Screenshots: `orders__dialog-confirm-order`, `orders__after-confirm-toast`, `orders__dialog-cancel-order`, `orders__cancel-reason-validation-toast`, `orders__after-state-changes`, `orders__dialog-mobile`.

---

## D. Payment Screenshots — `/admin/payments`

Source: `FE/pages/AdminPaymentsPage.tsx` · API `API/admin_payments.py`. Reached from Dashboard "Review" and the order drawer link (no sidebar link). Screenshots: `payments__empty-state`, `payments__populated`, `payments__chip-*`, `payments__drawer-*`, `payments__after-*`, `payments__screenshot-expanded`.

### F-30 Payment queue (list, stats, filters)
- **Stat cards** (computed client-side from the loaded rows): Pending Payment Queue (SUBMITTED+UNDER_REVIEW), Approved Payments, Rejected, Verified Receipts Total (Σ `expectedAmount` of VERIFIED).
- **Filters**: search (order number or customer name; server `search` + client filter) and chips All / Submitted / Under review / Verified / Rejected / Pending.
- **Columns**: Order Number (+ "Order: <STATUS>"), Customer (+ phone), Expected Amount, Screenshot Proof ("Private Bucket" badge), Submission Date (raw ISO), Payment Status, Action ("Check Screenshot" for SUBMITTED/UNDER_REVIEW, else "View"). No pagination (the API returns everything; `page/pageSize` are accepted but ignored).
- A permanent yellow "Check the screenshot carefully" policy notice sits above the stats.

### F-31 Payment inspector drawer
- **Shows**: order number, expected amount, payment + order status badges, submitted time, **customer screenshot** (loaded from a 5-minute signed URL; click or "View full image" enlarges it), approval section, rejection section, "Verification Audit History" timeline.
- **Approve Payment (Order → Awaiting Confirmation)**: optional note. If the proof is SUBMITTED the client first calls `POST …/review` (moves to UNDER_REVIEW) and then `POST …/approve` — two requests behind one button. Result: payment VERIFIED, order AWAITING_CONFIRMATION (never CONFIRMED), customer notification + audit rows.
- **Reject Payment / Request Corrected Proof**: reason textarea (≥ 5 chars, also enforced by the schema). Both call `POST …/reject`; the only difference is `requestCorrectedProof` (true/false), which changes the history label (PROOF_REQUESTED vs REJECTED). The order returns to PENDING_PAYMENT so the customer can upload a new proof.
- **Not shown by the UI**: no amount/UTR/receiver matching tools; the owner judges the image by eye (`ImagePreview` caption says so).
- Data REAL. Works: yes (T: PAY-*). 

---

## E. Price Management — `/admin/prices` (alias `/admin/products`)

Source: `FE/pages/AdminProductsPage.tsx` · API `API/admin_catalog.py` (`GET/PATCH /api/admin/products`, `POST/DELETE …/images`). Screenshots: `prices__*`.

### F-40 Product & pack-size pricing table
- One row per variant: Product (EN + GU) · Pack Size · Cost Price · Selling Price · Approval ("Approved" / "Development price" / "—") · Stock ("N (M held)") · Availability text ("On sale", "Off sale", "Out of stock", "Awaiting price", "Awaiting approval") · Action **Edit**.
- **Edit mode** (one row at a time): Cost input, Selling input (type=number ≥ 0, step 0.01), "Approved" checkbox, "On sale" checkbox, Save / Cancel. Typing a new selling price unticks Approved in the UI.
- **Save**: only changed fields are sent (`buildVariantPatch`). Server: changing price sets `price_confirmed = false` unless the same request sets it; approving without a price → 422; negative values → 422. Toast "Saved <product> <pack>. Price changes apply to future orders only."
- Errors: "Nothing changed." toast, invalid-number toast. Data REAL; customer storefront reads the same rows (verified through `GET /api/products`).

### F-41 Per-kg "Typed amount" row
- Appears for weight products (Faki, Supari, Mitho Mavo, Chuno, Tamaku; **not** Water): Cost per kg + Price per kg inputs; empty price = typed amounts off ("Off"). Server enforces 100 g–10 kg in 50 g steps when a customer orders. Water never shows the row.

### F-42 "Edit <product> details & photos" drawer (one button per product)
- Fields: name EN, name GU, category (required), description (≤ 2000), "Visible to customers" (`active`), nine "Confirmed product information" text areas (ingredients, popularity, characteristics, preparation, manufacturer, packaging, storage, shelf life, safety), **Photos** gallery (+ alt text, file input JPG/PNG/WEBP ≤ 4 MB, **Remove** per photo; max 10 photos).
- Save sends only changed fields. Product name < 2 chars → toast. Product deactivation hides it from the storefront catalogue.
- Photo upload is immediate (separate request) and independent of Save.

### F-43 "Manage stock" link → Inventory. Hardcoded link.

---

## F. Inventory — `/admin/inventory`

Source: `FE/pages/AdminInventoryPage.tsx` · API `GET /api/admin/inventory`, `POST /api/admin/inventory/adjustments` (`API/admin_catalog.py`). Reached only from Price Management → "Manage stock". Screenshots: `inventory__*`.

### F-50 Stock overview
- Header badge "Reservation Expiry Policy: N mins" (value from store settings; **informational only** — Settings states orders are never auto-cancelled). Four stat cards: Total Stock, Available, Reserved, Low Stock Alerts. Search (product, GU name, pack, SKU) and chips "All Variants (n)" / "Low Stock Alerts (n)" (client-side).
- Table: Product & Variant · SKU · Total · Available · Reserved · Threshold · Alert Status (Healthy / Low Stock Alert when available ≤ threshold) · **Adjust Stock**. Rows are sorted by product slug then pack size (not catalogue order).
- **Movement history** (latest 100): Timestamp (raw ISO), Variant, Movement Type, Delta (green +/ red −), Available before → after, Reason / order ref, Administrator. Types seen: ORDER_RESERVATION, RESERVATION_RELEASED, ORDER_CONFIRMED_DEDUCTION, MANUAL_ADD, MANUAL_DEDUCT.

### F-51 Manual stock adjustment drawer
- Operation (ADD / DEDUCT), Quantity (≥ 1, integer, default 10), Mandatory reason (≥ 5 chars). Client blocks: non-positive quantity, short reason, DEDUCT > available. Server re-checks (DEDUCT > available → 409; quantity ≤ 100000).
- After success: drawer closes, toast, inventory reloaded. Data REAL. Works: yes.
- The Threshold column shows each variant's own `low_stock_threshold` (10 for all seeded variants). No admin control edits it. The Settings field "Low-stock alert at (units)" writes a different column (`store_settings.low_stock_default_threshold`) that nothing reads when computing alerts — changing it to 100 left the alert count at 1 (verified, see `02_ADMIN_BUSINESS_RULES.md` R-INV-05).
- Reservation: the page shows "Reservation Expiry Policy: 30 mins" and "Expires after 30m if unpaid", but no code releases expired reservations (`stock_reservation_expires_at` is only written and shown). Reserved stock stays reserved until the order is cancelled or confirmed.

---

## G. Delivery & Fulfillment — `/admin/delivery`

Source: `FE/pages/AdminDeliveryPage.tsx` · API `GET /api/admin/deliveries`, `PATCH /api/admin/deliveries/{id}` (`API/admin_orders.py`). **No link to this page exists in the UI.** Screenshots: `delivery__*`.

### F-60 Fulfillment queue
- Six stat cards (Confirmed, Packing, Packed, Picked Up/Shipped, Out for Delivery, Delivered); search (order, customer, address, contact, rider); chips for 9 stages; table: Order ID · Customer & Contact · Shipping Address+PIN · Items · Assigned Delivery Staff · Tracking Ref · Fulfillment Status · Action (**Manage** + a primary button labelled with the next stage; both open the drawer — the primary button does not itself advance anything). Rows exist only after an order is confirmed (shipment created at confirmation). Cancelled orders keep their row. No pagination.

### F-61 Delivery drawer
- **Advance Fulfillment Stage**: buttons for each allowed next stage (CONFIRMED→PACKING; PACKING→PACKED; PACKED→PICKED_UP; PICKED_UP→SHIPPED | DELIVERY_FAILED; SHIPPED→OUT_FOR_DELIVERY | DELIVERY_FAILED; OUT_FOR_DELIVERY→DELIVERED | DELIVERY_FAILED; DELIVERY_FAILED→OUT_FOR_DELIVERY; DELIVERED final). Each click sends **the status plus whatever is typed in the metadata form** in one PATCH. "Record Delivery Failure" requires a reason ≥ 5 characters (client and server).
- **Delivery Staff & Dispatch Details** form (Save Delivery Metadata): assigned person, phone, courier/tracking ref, estimated delivery date, pickup date, dispatch date, notes — all **free-text** (dates are not validated as dates; placeholders show examples). A save without a status change adds an "<Stage> — Assignment Updated" history event. The `deliveredDate` field is sent by the API client but has **no input** in this form.
- **Immutable Delivery Event History** timeline.
- Customer effect: `order.status` changes with the shipment, so the customer's tracking (`GET /api/orders/{id}/tracking`) changes. Data REAL. Works: yes.

---

## H. Customers — `/admin/customers` (read-only)

Source: `FE/pages/AdminCustomersPage.tsx` · API `GET /api/admin/customers`, `GET /api/admin/customers/{id}` (`API/admin.py`). **No link to this page exists in the UI.** Screenshots: `customers__*`.

### F-70 Customer list
- Search (name, phone, e-mail; 250 ms debounce) · "Show" select (All / New / Repeat / Pending payment) · table (Customer, Phone, Area, Orders, Total spent, Last order, Rating, Status badge, View) · server pagination 20/page with Previous/Next.
- **Status** is derived: *Pending payment* if any order is PENDING_PAYMENT/PAYMENT_REVIEW; else *Repeat* if `order_count ≥ 2`; *New* if 0; else *Active*. `order_count`/`total_spent`/`last_order_at` change **only when the owner confirms an order**.
- Rating = average of that customer's PUBLISHED reviews. Area = `customers.area` (always "Rajkot" for orders placed through the API) else PIN.
- Implementation note: the API loads every customer, builds each row (two extra queries per customer: average rating and pending-order count), filters by status in Python and only then slices the requested page (`API/admin.py:356-368`). Results are correct; behaviour at large customer counts was not measured. With only 8 demo customers (page size 20) the second page of the pager could not be exercised (NOT TESTED).

### F-71 Customer detail drawer
- E-mail, address + PIN, joined date, order history (link per order → `/admin/orders?q=<number>`), reviews (rating + text). Read-only: no edit/delete/message actions exist.

---

## I. Feedback Management — `/admin/feedback` (alias `/admin/reviews`)

Source: `FE/pages/AdminReviewsPage.tsx` · API `GET /api/admin/reviews`, `PATCH /api/admin/reviews/{id}`, `GET /api/admin/reviews/photos/{id}`. Screenshots: `feedback__*`, `reviews__*`.

### F-80 Review list
- Stat cards (Total Feedback, Average Rating of published only, Published, Pending/Hidden); search (customer, order, product, area, text — client-side); rating select; chips All / Published / Pending / Hidden; table (Customer & Area, Order ID + "✓ Delivered Order", Product·Pack, stars, feedback + admin reply, Date (raw ISO), Status, **View / Reply**). The backend ignores the filter parameters and returns all reviews (single page, `pageSize: 50` label only); filtering happens in the browser.
- Customers can only review DELIVERED orders (enforced in `API/reviews.py`); reviews publish immediately (`PENDING_MODERATION` exists as a status but nothing in the code sets it).

### F-81 Review drawer
- Details, customer feedback text, customer photos (signed admin URLs), **Official Store Reply** (textarea + Save Admin Reply; empty text clears the reply), **Visibility & Moderation**: reason select (Spam / Abusive language / Private information / Prohibited content) + optional detail (≤ 300), **Hide Review** (disabled until a reason is chosen), **Make Public Again**.
- Server: hiding requires reason ≥ 3 chars; hidden reviews are excluded from public list, count and average (verified: 3 → 2 reviews, avg 4.5; restored → 3). Audit row `REVIEW_MODERATED`.

---

## J. Cancellations & Refunds — `/admin/refunds`

Source: `FE/pages/AdminRefundsPage.tsx` · API `GET /api/admin/refunds`, `POST …/approve`, `POST …/record-transfer` (`API/admin_orders.py`). **No link to this page exists in the UI**, although every cancellation of a paid order creates a refund that appears only here. Screenshots: `refunds__*`.

### F-90 Refund ledger
- Stat cards (Total, Pending, Approved/Processing, Completed). Search (order, customer, refund reference — client-side; the API ignores `search`), chips (All, Pending, Approved, Processing, Completed, Failed, Not required). Table: Order ID (+ cancelled time), Customer, Refund Amount, Cancellation Reason, Refund Bank Reference, Refund Date, Status, **Process Refund / View Audit**. The `PROCESSING`, `FAILED`, `NOT_REQUIRED` chips can never match: the backend never sets those statuses on stored refunds (NOT_REQUIRED is only a label on orders without a refund row).

### F-91 Refund drawer (two steps)
- **Step 1 — Approve Refund Request** (only when PENDING): server requires the original payment to be VERIFIED; optional notes.
- **Step 2 — Record Verified Bank Refund Transfer** (always visible, works only after APPROVED): reference/UTR (≥ 4), transfer date, source account (≥ 4), verified amount (must equal the refund amount to the paisa), notes, evidence radio — **Real bank transfer** (requires the tick "I found this refund transfer settled on the actual bank statement") or **LOCAL TEST** (shown only when `import.meta.env.PROD` is false; reference must start `TEST-`; server refuses it outside `BFP_ENV=local`). Duplicate references → 409; `TEST-` references are refused as real evidence.
- Result: refund COMPLETED, customer in-app notification, audit row; Completed refunds show a read-only success notice.
- Real money is **not** moved by this panel; it only records that the owner did the transfer elsewhere.

---

## K. Settings — `/admin/settings`

Source: `FE/pages/AdminSettingsPage.tsx` (uncommitted edits present in the working tree — see README) · API `GET/PATCH /api/admin/settings`, `POST …/confirm`, `POST/GET …/qr`, `POST/DELETE …/photos` (`API/admin.py`). Screenshots: `settings__*`.

### F-100 Payment & go-live confirmation
- UPI ID (format `name@bank`, ≤ 120), Payee name, Payment QR preview (signed 30-min admin URL) + upload (JPG/PNG/WEBP ≤ 2 MB), **Confirm payment, delivery & PIN settings** button. Warnings: "LOCAL TEST payment details" while the UPI ID starts with `local-test`; "Not confirmed yet" / "Confirmed on <date>".
- Button disabled when already confirmed or the UPI value is a LOCAL TEST one. Server `confirm` returns 422 listing missing items (real UPI id, real payee, QR uploaded, delivery charge set).
- Changing UPI id, payee name, delivery charge, free-delivery threshold, PIN list **or uploading a new QR** withdraws the confirmation (verified).
- Effect on customers: outside `BFP_ENV=local`, `_assert_ordering_open` refuses new orders until prices are approved **and** settings are confirmed. In the local test copy this gate is bypassed by design, so the gate itself was **not** exercised (NOT TESTED).

### F-101 Delivery & stock
- Delivery charge (₹, 0 = free), Free delivery above (₹, blank = none), Serviceable PIN codes (comma/space separated, unique 6-digit, blank = whole India), Low-stock alert at (units); read-only text about stock reservation minutes.
- The order flow uses charge and threshold at order creation. Validation: client (numbers ≥ 0, PIN regex) and server.

### F-102 Shop details (shown to customers)
- Shop name, tagline, address, opening hours, phone, WhatsApp (digits, 10-15), support e-mail (optional), shop introduction, preparation, provider/manufacturer, packaging. Empty optional fields are hidden on the storefront. Verified: public `GET /api/store` returned the new tagline.

### F-103 Save changes
- Sends only changed fields. No change → toast "No changes to save. Your settings are already saved." (this text was changed in the working tree during the session; the committed version showed an inline "Nothing has changed." error). Errors appear in a "Could not complete action" banner (committed: "Not saved").

### F-104 Shop photos
- Up to 20; caption (≤ 255) + file; Remove per photo. Immediate upload/delete. Verified add/remove through the API.

---

## L. Present in code but not available to the admin

### F-110 Reports (`AdminReportsPage.tsx`) — **MOCK / UNROUTED**
- 9 report categories, date range, product/payment/order filters, CSV export (`reportRowsToCsv`), reference data built in code (`buildReferenceReport`, hardcoded sample numbers with `null` amounts). Calls `GET /api/admin/reports`, which **does not exist** (404). Route `/admin/reports` redirects to dashboard. Not documented further because it cannot be run.

### F-111 Notifications (`AdminNotificationsPage.tsx`) — **MOCK / UNROUTED**
- Tabs History / Templates / Settings, 11 trigger templates and sample logs from `FE/lib/referenceData.ts` (1,070 lines of `SAMPLE_*` data). Calls `GET /api/admin/notifications` and `POST …/{id}/retry` — **neither exists** (404). Route redirects. Meanwhile the backend **does write** `notifications` rows (channel `IN_APP`, status `SENT`) on order created, payment verified/rejected, order confirmed/cancelled and refund completed; no API reads them.

### F-112 Audit log
- Every admin mutation writes `admin_audit_logs` (actor, action, module, previous/new JSON). **No admin page or endpoint displays them** (no `select(AdminAuditLog)` anywhere in `backend/app`).
