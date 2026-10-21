# 07 — Functionality Status (verified, not assumed)

## How features were tested
- **Environment (isolated, nothing real touched)**: the unmodified FastAPI backend and the unmodified Admin Panel dev server, running locally on `http://127.0.0.1:8000` and `http://localhost:5174`, with a **SQLite file** created in a scratch folder (`BFP_ENV=local`), the project's own development seed (6 products, LOCAL TEST payment values), and **20 demo orders** created by calling the real customer and admin API endpoints in-process. Two stand-ins, both outside the repository: (1) the S3/Neon Object Storage transport was replaced by a folder on disk (the same single function `core/storage._storage_request` that the project's own tests replace); (2) the fixed admin login used a throwaway email/password that exists only in that process. **No Neon database, Neon Auth, Vercel deployment or real storage was contacted**, and no source file was changed.
- **Browser automation**: Playwright (Chromium) drove the real UI — sign-in, filters, drawers, dialogs, forms — and each mutation was then re-read from the API (and, for customer effects, from the public API) to confirm persistence.
- **Automated suites run as-is**: Admin Panel `npm test` (PASS), `npm run typecheck` (exit 0, no errors), backend `python -m unittest discover -s backend/tests` (**110 tests, OK** once the storage env variables are non-empty; with them blank, 1 test — `test_product_and_shop_images` — fails because that test needs `AWS_ENDPOINT_URL_S3` to be set; this is an environment dependency of the test, not an application defect I could attribute).
- **Not touched / not testable here**: Neon Auth customer sign-in, real object storage, real e-mail/SMS (none exist), the storefront UI, live Vercel/production. A browser-side stub was used only for the "role = CUSTOMER" screen and for error/loading states (noted per row).
- Status labels: **WORKING — VERIFIED**, **UI ONLY**, **MOCK / DEMO**, **PARTIALLY IMPLEMENTED**, **BROKEN — VERIFIED**, **NOT TESTED**, **CANNOT VERIFY**. Test ids (e.g. `ORD-CONFIRM`) point to the log in §3.
- Nothing was fixed.

## 1. Feature status

| Feature (id from `01`) | Status | Evidence / exact test |
|---|---|---|
| F-01 Admin sign-in | **WORKING — VERIFIED** | Empty submit → inline error; wrong password → 401 message; correct → dashboard; unknown JSON field → 422; throttle → 429 after 10 failures (`AUTH-*`, `SEC-LOGIN-*`). *Caveat*: the throttle also rejects the correct password while locked (`SEC-LOGIN-LOCKOUT-AFFECTS-OWNER`). |
| F-02 Route guard / role check | **WORKING — VERIFIED** (sign-in, retry, failed role check) · the "customer role" screen is **MOCK / DEMO** here | `/api/me` stubbed in the browser to return 500 / role CUSTOMER (`GUARD-*`). A real customer token could not be produced without Neon Auth → server-side 403 for customers is **CANNOT VERIFY** at runtime (project unit test covers it). Forged token → 401 (`SEC-FORGED-TOKEN`, `AUTH-TAMPERED-TOKEN`). |
| F-03 Sidebar | **WORKING — VERIFIED** | All 5 links navigate; mobile drawer opens (`shell__sidebar-open__mobile`). |
| F-04 Header global search | **PARTIALLY IMPLEMENTED** | Works from another page (`HDR-SEARCH-NAV`); **BROKEN — VERIFIED** when already on Orders (`HDR-SEARCH-SAMEPAGE`: URL changes, search box and list stay on the old query). |
| F-05 Profile modal | **WORKING — VERIFIED** | Validation + save persisted (`HDR-PROFILE-*`). No Escape-to-close (observed). |
| F-06 Store link / Log out | Log out **WORKING — VERIFIED** (`AUTH-LOGOUT`); Store link **NOT TESTED** (external site) | Token is not revoked server-side (code reading, R-AUTH-03). |
| F-07 Toast / dialog / drawer components | **WORKING — VERIFIED** | exercised in every test; Escape closes drawers and the confirm dialog (`ORD-DRAWER-ESC`). |
| F-10 Products Sold tile | **WORKING — VERIFIED** | 6 before, 8 after delivering a 2-unit order (`ORD-DELIVER`). |
| F-11 Net Profit tile | **WORKING — VERIFIED** | ₹1,950 → ₹2,210 = +₹260 = (300 − 170) × 2 units of the newly delivered order (`ORD-DELIVER`). "Not configured" branch **NOT TESTED** (all seeded items have a cost). |
| F-12 Pending confirmations + Review link | **WORKING — VERIFIED** | 2 rows → link opens the right drawer (`DASH-REVIEW-LINK`); empty state captured. |
| F-20 Orders list, search, filters | **WORKING — VERIFIED** | status, payment, name, phone-digits, date, no-result (`ORD-FILTER-*`, `ORD-SEARCH-*`). Paging beyond 200 rows **NOT TESTED**; "pagination" footer is only a count. |
| F-21 Order drawer | **WORKING — VERIFIED** | 4 states captured (delivered, payment-review warning, cancelled+refund, typed amount). |
| F-22 Order actions | **WORKING — VERIFIED** (confirm, confirm typed amount, start packing, mark delivered, cancel unpaid, cancel paid) · "Delivery failed" action **PARTIALLY IMPLEMENTED** | Stock −1 on confirm, +1 on cancel, refund PENDING created (`ORD-CONFIRM`, `ORD-CANCEL-*`). No failure button on this page (`ORD-NO-FAIL-ACTION`). Drawer opens after every action (`ORD-ACTION-OPENS-DRAWER`). |
| F-30 Payment queue | **WORKING — VERIFIED** | chips and search (`PAY-CHIP-*`, `PAY-SEARCH`). |
| F-31 Payment approve / reject / request proof | **WORKING — VERIFIED** | Approve → VERIFIED + AWAITING_CONFIRMATION (`PAY-APPROVE`); request proof → order PENDING_PAYMENT (`PAY-REQUEST-PROOF`); short reason blocked (`PAY-REJECT-VALIDATION`). Screenshot viewing used synthetic images on the stand-in storage; real object storage **NOT TESTED**. |
| F-40 Price table edit | **WORKING — VERIFIED** | price change resets approval; approve; availability toggle; negative price blocked; customer API reflects it (`PRICE-*`). |
| F-41 Per-kg typed amount | **WORKING — VERIFIED** | `PRICE-PER-KG`; the seeded typed order (750 g × ₹900/kg) priced ₹675. |
| F-42 Product details + photos | **WORKING — VERIFIED** (stand-in storage) | `PRICE-PRODUCT-DETAILS`, `PRICE-REMOVE-PHOTO`. |
| F-50 Inventory overview/search/filter | **WORKING — VERIFIED** | `INV-LOW-FILTER`, `INV-SEARCH-SKU`. |
| F-51 Stock adjustment | **WORKING — VERIFIED** | ADD persisted and logged (`INV-ADJUST-ADD`); over-deduct and short reason blocked (`INV-OVERDEDUCT`, `INV-SHORT-REASON`). |
| Low-stock threshold setting; reservation-expiry display | **PARTIALLY IMPLEMENTED** | setting has no effect on alerts (`SET-LOW-STOCK-NO-EFFECT`); no code expires reservations (code search). |
| F-60 / F-61 Delivery queue and drawer | **WORKING — VERIFIED** | failure with reason, advance with metadata, metadata-only save (`DEL-*`). UI observations: no link to the page; action column clipped at 1440 px; no input for delivered date. |
| F-70 / F-71 Customers | **WORKING — VERIFIED** | search, Repeat filter, detail drawer (`CUST-*`). Page 2 of the pager **NOT TESTED** (8 customers). Counters never decrease after cancel (`CUST-COUNTERS-AFTER-CANCEL`: **PARTIALLY IMPLEMENTED** as a business behaviour). |
| F-80 / F-81 Feedback | **WORKING — VERIFIED** | rating filter, reply, hide (public count 3→2, restored 3), reason required (`REV-*`). Review photo displayed in drawer. |
| F-90 / F-91 Refunds | **WORKING — VERIFIED** for approve and LOCAL TEST completion and all blocking rules | `REF-*`. The real **BANK_TRANSFER success path** was **NOT TESTED** (only its guards: attestation tick, TEST- reference refusal). Chips Processing / Failed / Not required cannot match anything (states never produced). |
| F-100 Payment / go-live confirmation | **WORKING — VERIFIED** | replace UPI, upload QR, confirm, then change delivery → confirmation withdrawn (`SET-SAVE`, `SET-CONFIRM`, `SET-WITHDRAW`). The ordering gate that this feeds (outside local mode) is **NOT TESTED**. |
| F-101 / F-102 Delivery rules, shop details | **WORKING — VERIFIED** | validation and save (`SET-PIN-VALIDATION`, `SET-NEGATIVE-DELIVERY`, `SET-SAVE`, `SET-NOCHANGE`); public `/api/store` shows new tagline. |
| F-104 Shop photos | **WORKING — VERIFIED** (stand-in storage) | add → 1, remove → 0 (`SET-PHOTOS`). |
| F-110 Reports | **MOCK / DEMO** (and unreachable) | route redirects; backend `GET /api/admin/reports` = 404 (`API-REPORTS-NOTIFICATIONS-MISSING`); page uses sample data and a CSV helper that never ran. |
| F-111 Notifications page | **MOCK / DEMO** (and unreachable) | same; sample data in `referenceData.ts`; backend 404. |
| In-app notifications (data) | **PARTIALLY IMPLEMENTED** | 71 rows written during the run (order created, payment verified, …) but there is no way to read them in the admin or via any API. |
| Audit log (data) | **PARTIALLY IMPLEMENTED** | 117 rows written (ORDERS 56, PAYMENTS 49, REFUNDS 3, REVIEWS 4 …) — verified by reading the demo database; no screen/endpoint shows them. |
| Payment auto-matching (UTR / bank credit) | **NOT IMPLEMENTED** (not a UI feature) | `bank_credits` table has 0 rows; no endpoint writes UTRs. |
| Responsive/mobile layout | **WORKING — VERIFIED** with observations | all pages captured at 390 px; table scroll inside cards; 45 small touch targets on Orders; search placeholder clipped. |
| Accessibility basics | skip link **WORKING — VERIFIED**; contrast, focus trapping, screen-reader behaviour **NOT TESTED** | `A11Y-*`. |
| Admin API access control | **WORKING — VERIFIED** | 13 endpoints → 401 without a token; forged tokens → 401; state-machine violations → 409/422 when called directly (`SEC-*`, `API-*`). |

### Defects / oddities discovered (documented, not fixed)
1. Header search does nothing visible when already on `/admin/orders` (**BROKEN — VERIFIED**, `HDR-SEARCH-SAMEPAGE`).
2. Delivery, Customers and Refunds pages have no navigation entry; refunds created by cancellations are otherwise invisible.
3. "Low-stock alert at (units)" setting has no effect; reservation expiry is display-only.
4. Cancelling after DELIVERY_FAILED does not return stock but still creates a full refund; customer counters never decrease after cancellation.
5. Orders page cannot record DELIVERY_FAILED; only the Delivery page can.
6. Raw ISO timestamps in several tables/timelines; inconsistent date formats.
7. Login throttle can lock out the legitimate owner (and is per server instance).
8. Orders list has no real pagination (hard cap 200); search sends a request per keystroke.
9. Customer detail "area" is always "Rajkot" for API-created customers.
10. Uncommitted working-tree edits by another actor changed Settings page text while testing (see README).

## 2. Automated suites (as-is)

| Suite | Command | Result |
|---|---|---|
| Admin Panel tests | `cd admin-panel && npm test` | PASS ("Admin panel & Neon DB: 18 tables, RLS policies, RBAC route guard, navigation including Settings, minimal Dashboard …, typed API client passed.") |
| Admin Panel typecheck | `npm run typecheck` | exit code 0, no diagnostics |
| Backend unit tests | `python -m unittest discover -s backend/tests` | 110 tests **OK** with storage env variables non-empty; 109 OK + 1 FAIL (`test_admin_modules.AdminModuleTests.test_product_and_shop_images`, `AssertionError: 0 != 1`) with `AWS_ENDPOINT_URL_S3` blank. Both runs used an isolated SQLite DB. |
| Production build / storefront tests | not run (out of scope) | NOT TESTED |

## 3. Test log (every recorded runtime test)

`Verdict` is the label assigned at test time; rows marked *observation* record behaviour that had no pass/fail expectation.

| # | Test id | Feature | Test performed | Expected | Observed | Verdict |
|---|---|---|---|---|---|---|
| 1 | A11Y-SKIP-LINK | Accessibility: skip link | Pressed Tab once on the dashboard | First focus = "Skip to admin content" | {"cls":"skip-link","text":"Skip to admin content"} | WORKING — VERIFIED |
| 2 | A11Y-SKIP-LINK-TARGET | Accessibility: skip link target | Activated the skip link | Focus moves to #admin-main-content | {"hash":"#admin-main-content","active":"admin-main-content"} | WORKING — VERIFIED |
| 3 | A11Y-TOUCH-TARGETS | Mobile touch targets (<44 px) on Orders | Measured every button/link-button/input/select on /admin/orders at 390 px | UNKNOWN | 45 controls smaller than 44 px in a dimension; examples: ✕(36x36), ← Customer Store(219x40), Log out(219x40), ☰(40x40), Global admin search(314x40) | WORKING — VERIFIED *(observation)* |
| 4 | API-404 | Unknown id | Approve payment "does-not-exist" | 404 | 404 | WORKING — VERIFIED |
| 5 | API-CANCEL-REASON | Cancel needs a reason (server-side) | PATCH #BFP-1020 -> CANCELLED with a 3-character reason | 422 | 422: Cancellation reason (at least 5 characters) is required. | WORKING — VERIFIED |
| 6 | API-CONFIRM-UNPAID | Cannot confirm an unpaid order | POST confirm on #BFP-1012 (PENDING_PAYMENT) | 409 | 409: Invalid order transition from PENDING_PAYMENT to CONFIRMED. | WORKING — VERIFIED |
| 7 | API-DELIVERED-LOCKED | Order state machine at the API | PATCH #BFP-1004 (DELIVERED) -> PACKING directly via the API | 409 | 409: Delivered orders are completed and cannot be transitioned. | WORKING — VERIFIED |
| 8 | API-NEGATIVE-PRICE | Negative price rejected (server-side) | PATCH price -1 | 422 | 422: "Selling price cannot be negative." | WORKING — VERIFIED |
| 9 | API-PAYMENT-STATES-LOCKED | Payment-order states cannot be set manually | PATCH status -> PAYMENT_REVIEW | 409 | 409: Payment-order states can only be changed by payment proof, review, approval, or rejection endpoints. | WORKING — VERIFIED |
| 10 | API-REPORTS-NOTIFICATIONS-MISSING | Reports and Notifications backend | GET /api/admin/reports and /api/admin/notifications (called by the unrouted page files) | UNKNOWN | reports=404, notifications=404 | MOCK / DEMO |
| 11 | API-UPI-FORMAT | UPI id format (server-side) | PATCH officialUpiId="not a upi" | 422 | 422: Enter a valid UPI ID such as name@bank. | WORKING — VERIFIED |
| 12 | AUTH-LOGOUT | Log out | Clicked Log out in the profile modal | Token removed from sessionStorage; sign-in form shown | token=removed | WORKING — VERIFIED |
| 13 | AUTH-TAMPERED-TOKEN | Tampered/expired session token | Replaced the stored admin token with a forged value and reloaded /admin/orders | Server rejects (401); user returned to sign-in | sign-in form shown, token cleared | WORKING — VERIFIED |
| 14 | CUST-COUNTERS-AFTER-CANCEL | Customers: counters when a confirmed order is cancelled | Cancelled confirmed order #BFP-1007 (Rahul Mehta, ₹250) through the API and re-read /admin/customers | UNKNOWN (counters are incremented in confirm; _cancel_order never touches them) | cancel HTTP 200; orders 3 -> 3; totalSpent 2400 -> 2400 | PARTIALLY IMPLEMENTED |
| 15 | CUST-FILTER-REPEAT | Customers: status filter | Selected "Repeat" | customers with >=2 confirmed orders, no pending payment | 2 rows: Hetal Patel, Rahul Mehta | WORKING — VERIFIED |
| 16 | CUST-SEARCH | Customers: search | Searched "kotecha" (case-insensitive name) | 1 row | 1 | WORKING — VERIFIED |
| 17 | DASH-REVIEW-LINK | Dashboard: Review link | Clicked Review on the first pending-confirmation row | Payments page opens with that payment drawer | 2 pending rows; drawer title "Payment — #BFP-1009" | WORKING — VERIFIED |
| 18 | DEL-ADVANCE-META | Delivery: advance stage with metadata | Filled rider, phone, ref then Mark Shipped on #BFP-1018 | SHIPPED with rider and ref stored | toast="Order #BFP-1018 marked Shipped."; status=SHIPPED; rider=Ramesh Demo; ref=LOCAL-REF-18 | WORKING — VERIFIED |
| 19 | DEL-CHIP | Delivery: stage chip | Clicked "Out for delivery" chip | 1 row (#1004) | 1 row(s) | WORKING — VERIFIED |
| 20 | DEL-FAIL | Delivery: record delivery failure | Failure reason entered on #BFP-1005 (SHIPPED) then Record Delivery Failure | DELIVERY_FAILED on both delivery and order | toast="Order #BFP-1005 marked Delivery failed."; order=DELIVERY_FAILED | WORKING — VERIFIED |
| 21 | DEL-FAIL-VALIDATION | Delivery: failure reason required | Clicked Record Delivery Failure with empty reason | Blocked | Enter a delivery failure reason (at least 5 characters). | WORKING — VERIFIED |
| 22 | DEL-SAVE-META | Delivery: save assignment details only | Entered rider + notes on #BFP-1019 and pressed Save Delivery Metadata | Saved without changing stage; adds an "Assignment Updated" history event | toast="Delivery assignment details saved for #BFP-1019."; status=PACKED; rider=Meena Demo; last history="Packed & Ready — Assignment Updated" | WORKING — VERIFIED |
| 23 | GUARD-CUSTOMER | Route guard: non-admin role blocked | Browser-side stub made GET /api/me return role CUSTOMER | Admin UI stays locked | Owner Admin role required notice shown, no admin shell | WORKING — VERIFIED |
| 24 | GUARD-ME-500-ONLOAD | Route guard when /api/me fails on page load | Browser-side stub made GET /api/me return 500 and reloaded the dashboard | UNKNOWN | Sign-in form shown; token still in sessionStorage = true | WORKING — VERIFIED *(observation)* |
| 25 | GUARD-RETRY | Route guard: Try again | Made the guard GET /api/me fail once (browser-side), then restored it and pressed Try again | Admin UI opens | admin shell rendered | WORKING — VERIFIED |
| 26 | HDR-PROFILE-ESC | Profile modal keyboard close | Pressed Escape with the profile modal open | UNKNOWN (no Escape handler in AdminHeader.tsx) | modal stayed open (closes only via X button or backdrop click) | WORKING — VERIFIED *(observation)* |
| 27 | HDR-PROFILE-SAVE | Profile modal: save | Saved name "Owner Demo" and phone 9800000099 | PATCH /api/me stores them on the admin user profile | API me: fullName="Owner Demo" phone="+919800000099" role=OWNER_ADMIN | WORKING — VERIFIED |
| 28 | HDR-PROFILE-VALIDATION | Profile modal validation | Entered phone 12345 and pressed Save Profile | Validation message | Enter a 10-digit Indian mobile number starting with 6, 7, 8 or 9. | WORKING — VERIFIED |
| 29 | HDR-SEARCH-NAV | Header global search (from another page) | On Dashboard typed BFP-1004 in the header search and pressed Enter | Orders page opens filtered to #BFP-1004 | url=http://localhost:5174/admin/orders?q=BFP-1004 rows=1 | WORKING — VERIFIED |
| 30 | HDR-SEARCH-SAMEPAGE | Header global search (while already on Orders page) | On /admin/orders (filtered by BFP-1004) searched BFP-1002 from the header | List switches to #BFP-1002 | url=http://localhost:5174/admin/orders?q=BFP-1002; order search box="BFP-1004"; first row=#BFP-1004 | BROKEN — VERIFIED |
| 31 | INV-ADJUST-ADD | Inventory: manual ADD | ADD 20 to Water 1 L with a reason | Total stock +20, MANUAL_ADD movement logged, alert cleared | toast="Adjusted stock for Water Bottle (1l)."; total 5 -> 25; latest movement=MANUAL_ADD delta=20 reason="Demo: fresh water batch received" actor=owner-demo@example.test | WORKING — VERIFIED |
| 32 | INV-LOW-FILTER | Inventory: low stock filter | Clicked Low Stock Alerts | Water 1 L only (5 <= 10) | Water Bottle (પાણીની બોટલ) · 1 LBFP-WATER-1L53210Low Stock AlertAdjust Stock | WORKING — VERIFIED |
| 33 | INV-OVERDEDUCT | Inventory: cannot deduct more than available | DEDUCT 99999 from first variant | Rejected | Stock Adjustment BlockedCannot deduct 99999 units when available stock is 47. Negative available stock is never allowed. | WORKING — VERIFIED |
| 34 | INV-SEARCH-SKU | Inventory: search by SKU | Searched BFP-FAKI-1KG | 1 row | 1 row(s) | WORKING — VERIFIED |
| 35 | INV-SHORT-REASON | Inventory: reason min length | Reason "abc" (5-char minimum) | Rejected | Stock Adjustment BlockedPlease enter a clear reason (at least 5 characters) for the audit log. | WORKING — VERIFIED |
| 36 | MOB-TABLE-SCROLL | Mobile: tables | Measured the Orders table wrapper at 390 px | UNKNOWN | table scrollWidth=1033, visible width=324; whole page horizontal overflow=false | WORKING — VERIFIED *(observation)* |
| 37 | ORD-ACTION-OPENS-DRAWER | Orders: detail drawer opens after a row action | Used "Mark Picked Up" on #BFP-1019 from the table row without opening the drawer | UNKNOWN (code calls setSelectedOrder(updated) after success) | Drawer opened automatically: "Order #BFP-1019" | WORKING — VERIFIED *(observation)* |
| 38 | ORD-ADVANCE | Orders: Start Packing | Start Packing on #BFP-1007 | PACKING; shipment delivery_status PACKING | toast="Order #BFP-1007 updated to Packing."; order=PACKING | WORKING — VERIFIED |
| 39 | ORD-CANCEL-FROM-FAILED | Orders: cancel after DELIVERY_FAILED | Cancelled #BFP-1017 (DELIVERY_FAILED, VERIFIED payment, Mitho Mavo 250g x1) via the API | UNKNOWN (code skips stock release when previous status is DELIVERY_FAILED) | HTTP 200; order=CANCELLED; refund=PENDING; Mitho Mavo 250g total stock 49 -> 49 | WORKING — VERIFIED |
| 40 | ORD-CANCEL-PAID | Orders: cancel paid order creates refund | Cancel #BFP-1006 (PACKING, VERIFIED) with a reason | CANCELLED, Refund PENDING for the order total, stock returned (+1) | toast="Order #BFP-1006 updated to Cancelled."; order=CANCELLED; refund=PENDING; Tamaku 250g total stock 48 -> 49 | WORKING — VERIFIED |
| 41 | ORD-CANCEL-UNPAID | Orders: cancel unpaid order | Cancel #BFP-1011 (PENDING_PAYMENT) with a reason | CANCELLED, no refund created, reserved stock released | toast="Order #BFP-1011 updated to Cancelled."; order=CANCELLED; refund=NOT_REQUIRED | WORKING — VERIFIED |
| 42 | ORD-CANCEL-VALIDATION | Orders: cancel reason validation | Opened Cancel dialog for #BFP-1011 and confirmed with empty reason | Blocked client-side with a warning toast | Please enter a cancellation reason (at least 5 characters). | WORKING — VERIFIED |
| 43 | ORD-CONFIRM | Orders: Confirm Order | Confirm Order on #BFP-1008 (AWAITING_CONFIRMATION, payment verified), Supari 500g | Order CONFIRMED, shipment created, total stock -1 and Confirm creates a stock deduction movement, customer order_count +1 | toast="Order #BFP-1008 updated to Confirmed."; order=CONFIRMED; total stock 50 -> 49; timeline entries=4 | WORKING — VERIFIED |
| 44 | ORD-CONFIRM-TYPED | Orders: confirm typed-amount order | Confirm #BFP-1020 (Faki 750 g typed amount) | CONFIRMED without any stock change (no variant) | toast="Order #BFP-1020 updated to Confirmed."; order=CONFIRMED | WORKING — VERIFIED |
| 45 | ORD-DELIVER | Orders: Mark Delivered | Mark Delivered on #BFP-1004 (Mitho Mavo 500g x2) | DELIVERED and counted in dashboard Products Sold | toast="Order #BFP-1004 updated to Delivered."; order=DELIVERED; dashboard productsSold=8, netProfit=2210 | WORKING — VERIFIED |
| 46 | ORD-DRAWER-ESC | Drawer closes on Escape | Opened order drawer, pressed Escape | Drawer closes | closed | WORKING — VERIFIED |
| 47 | ORD-FILTER-DATE | Orders: date filter | From Date = 2030-01-01 | No orders | 1 row; "No orders match the current search and status filt" | WORKING — VERIFIED |
| 48 | ORD-FILTER-PAY | Orders: payment status filter | Selected "Submitted" in Payment Status | 2 orders (#BFP-1009, #BFP-1010) | 2 rows | WORKING — VERIFIED |
| 49 | ORD-FILTER-STATUS | Orders: status filter | Selected "Confirmed" in the Order Status dropdown | Only #BFP-1007 listed | 1 row(s) | WORKING — VERIFIED |
| 50 | ORD-NO-FAIL-ACTION | Orders page: Delivery Failed action | Listed action buttons for #BFP-1005 (SHIPPED) | UNKNOWN: DELIVERY_FAILED is allowed by the state machine | buttons: View Order \| Mark Out for Delivery | PARTIALLY IMPLEMENTED |
| 51 | ORD-SEARCH-NAME | Orders: search by name | Typed "Rahul" in the search box | 3 orders (#1001, #1007, #1017) | 3 rows | WORKING — VERIFIED |
| 52 | ORD-SEARCH-PHONE | Orders: search by phone digits | Typed 9800000004 (stored as +919800000004) | 3 orders of Pooja Dave (#1004, #1012, #1020) | 3 rows | WORKING — VERIFIED |
| 53 | PAY-APPROVE | Payments: approve screenshot | Opened #BFP-1009 (SUBMITTED), added note, clicked Approve Payment | Payment VERIFIED and order AWAITING_CONFIRMATION (never CONFIRMED) | toast="Payment for #BFP-1009 approved. Order moved to AWAITING_CONFIRMATION."; API: payment=VERIFIED, order=AWAITING_CONFIRMATION | WORKING — VERIFIED |
| 54 | PAY-CHIP-REJECTED | Payments: status chip | Clicked chip Rejected | 1 row (#1012 attempt) | 1 rows | WORKING — VERIFIED |
| 55 | PAY-CHIP-SUBMITTED | Payments: status chip | Clicked chip Submitted | 2 rows (#1009,#1010) | 2 rows | WORKING — VERIFIED |
| 56 | PAY-CHIP-VERIFIED | Payments: status chip | Clicked chip Verified | >=1 rows | 15 rows | WORKING — VERIFIED |
| 57 | PAY-REJECT-VALIDATION | Payments: reject reason validation | Typed "abc" as reason and clicked Reject Payment | Blocked with message | Action blockedEnter a clear reason (at least 5 characters) explaining why the payment proof was rejected or needs correc | WORKING — VERIFIED |
| 58 | PAY-REQUEST-PROOF | Payments: request corrected proof | Entered a reason on #BFP-1010 and clicked Request Corrected Proof | Payment REJECTED (proof requested), order back to PENDING_PAYMENT / payment PENDING | toast="Requested corrected payment proof for #BFP-1010."; API: order=PENDING_PAYMENT, orderPayment=PENDING | WORKING — VERIFIED |
| 59 | PAY-SEARCH | Payments: search | Searched "Amit" | Payments of Amit Joshi (#1009, #1015) | 2 rows | WORKING — VERIFIED |
| 60 | PRICE-APPROVE | Prices: approve a price | Edit Faki 1kg, tick Approved, Save | priceConfirmed=true | toast="Saved Faki 1 kg. Price changes apply to future orders only."; confirmed=true | WORKING — VERIFIED |
| 61 | PRICE-AVAILABILITY | Prices: pack on/off sale | Unticked On sale for Supari 250g and saved | Public catalogue: price null and inStock false for 250g | toast="Saved Supari 250 g. Price changes apply to future orders only."; public price=null inStock=false | WORKING — VERIFIED |
| 62 | PRICE-NEGATIVE | Prices: negative price | Entered -5 as Faki 250g selling price and saved | Rejected | Enter a valid selling price in rupees (0 or more). | WORKING — VERIFIED |
| 63 | PRICE-PER-KG | Prices: per-kg typed amount | Set Supari price per kg = 800 and saved | Public pricePerKg=800 | toast="Saved Supari: ₹800 per kg for typed amounts."; public pricePerKg=800 | WORKING — VERIFIED |
| 64 | PRICE-PRODUCT-DETAILS | Prices: product details + photo | Edited Chuno description + ingredients, uploaded a PNG photo (the script selected the file twice, so two photos were added), saved | Description/ingredients saved; images 3 -> 5; visible in the public catalogue | Saved; public description and ingredients returned the new text; 5 images afterwards | WORKING — VERIFIED |
| 65 | PRICE-REMOVE-PHOTO | Prices: remove photo | Pressed Remove on the last Chuno photo | Image count 5 -> 4 | toast "Photo removed."; images=4 | WORKING — VERIFIED |
| 66 | PRICE-SAVE-RESETS-APPROVAL | Prices: changing the selling price withdraws approval | Edited Faki 1kg price 1000 -> 1100 (was Approved) and cost 350 -> 360, saved | Saved; priceConfirmed=false; customer store shows 1100 | toast="Saved Faki 1 kg. Price changes apply to future orders only."; API price=1100 cost=360 confirmed=false; public price=1100 priceConfirmed=false | WORKING — VERIFIED |
| 67 | REF-AMOUNT-MISMATCH | Refunds: amount must equal the refund amount | Entered 123 instead of the refund amount | Rejected client-side | Refund Verification BlockedVerified refund transfer amount must match the approved refund amount. | WORKING — VERIFIED |
| 68 | REF-APPROVE | Refunds: approve eligibility | Approved the PENDING refund for #BFP-1014 | APPROVED | toast="Refund for #BFP-1014 approved for bank transfer."; status=APPROVED | WORKING — VERIFIED |
| 69 | REF-CHIP-PENDING | Refunds: status chip | Clicked Pending | 1 row (#1014) | 1 | WORKING — VERIFIED |
| 70 | REF-COMPLETE-LOCALTEST | Refunds: complete with LOCAL TEST evidence | Recorded TEST-REFUND-0014 with the exact amount | COMPLETED; notes prefixed "LOCAL TEST EVIDENCE." | toast="Recorded verified refund transfer for #BFP-1014."; status=COMPLETED; notes="LOCAL TEST EVIDENCE. Actual bank refund transfer independently verified." | WORKING — VERIFIED |
| 71 | REF-DUPLICATE-REF | Refunds: duplicate transfer reference | Reused reference TEST-REFUND-0001 already used by #BFP-1016 | Rejected 409 | Refund Verification BlockedRefund bank-transfer reference is already recorded. | WORKING — VERIFIED |
| 72 | REF-NEEDS-APPROVAL | Refunds: transfer cannot be recorded before approval | Ticked attestation and submitted on a PENDING refund | Blocked (must be APPROVED first) | Refund Verification BlockedRefund must be APPROVED before recording a completed bank transfer. | WORKING — VERIFIED |
| 73 | REF-NEEDS-ATTEST | Refunds: attestation required | Filled reference and account, left the settlement checkbox unticked, pressed Verify & Mark COMPLETED | Blocked | Refund Verification BlockedConfirm that the refund transfer is visible as settled on the actual bank statement. A typed reference alone is n | WORKING — VERIFIED |
| 74 | REF-TEST-REF-AS-BANK | Refunds: TEST- reference refused as real evidence | Real bank-transfer evidence with a reference starting TEST- | Rejected 422 by server | Refund Verification BlockedTEST references cannot be used as real refund evidence. | WORKING — VERIFIED |
| 75 | REV-FILTER-RATING | Reviews: rating filter | Selected "1 Star" | 1 review (#1003) | 1 row(s) | WORKING — VERIFIED |
| 76 | REV-HIDE | Reviews: hide with reason | Hid the 1-star review #BFP-1003 with reason Spam | HIDDEN, removed from public reviews and average | toast="Review hidden. It stays in admin history."; public review count 3 -> 2; public avg=4.5 | WORKING — VERIFIED |
| 77 | REV-HIDE-NEEDS-REASON | Reviews: Hide button requires a reason | Opened a published review without choosing a reason | Hide Review disabled | disabled | WORKING — VERIFIED |
| 78 | REV-REPLY | Reviews: admin reply | Wrote a reply on the #BFP-1001 review and saved | Reply stored and returned in the public reviews API | toast="Reply saved."; public adminReply="Thank you Rahul! Happy to serve you again." | WORKING — VERIFIED |
| 79 | REV-UNHIDE | Reviews: make public again | Pressed Make Public Again | PUBLISHED, back in public list | toast="Review is public again."; public count=3 | WORKING — VERIFIED |
| 80 | SEC-FORGED-TOKEN | Admin API with forged tokens | Sent three forged Bearer tokens (admin-prefixed bad signature, junk, 3-segment junk) to GET /admin/orders | 401 each | 401, 401, 401 | WORKING — VERIFIED |
| 81 | SEC-LOGIN-EXTRA-FIELD | Admin login: unknown JSON field | POST /api/admin/login with an extra field | 422 (extra=forbid) | 422 | WORKING — VERIFIED |
| 82 | SEC-LOGIN-LOCKOUT-AFFECTS-OWNER | Throttle also blocks the correct password | After the lock, logged in with the CORRECT credentials | UNKNOWN | status 429 | WORKING — VERIFIED *(observation)* |
| 83 | SEC-LOGIN-RATE-LIMIT | Admin login throttle | Sent repeated wrong logins to POST /api/admin/login | 429 after 10 recent failures (per server process) | last status 429 after 10 further attempts | WORKING — VERIFIED |
| 84 | SEC-LOGIN-WRONG | Admin login: wrong credentials | POST /api/admin/login with an unknown email | 401 | 401 | WORKING — VERIFIED |
| 85 | SEC-NO-TOKEN | Admin API without credentials | Called 13 admin endpoints with no Authorization header | All 401 | GET /admin/dashboard=401, GET /admin/orders=401, GET /admin/payments=401, GET /admin/products=401, GET /admin/inventory=401, GET /admin/deliveries=401, GET /admin/customers=401, GET /admin/reviews=401, GET /admin/refunds=401, GET /admin/settings=401, PATCH /admin/settings=401, POST /admin/inventory/adjustments=401, POST /admin/s | WORKING — VERIFIED |
| 86 | SET-CONFIRM | Settings: confirm payment, delivery & PIN settings | Replaced the LOCAL TEST UPI, uploaded QR, pressed Confirm | businessSettingsConfirmedAt set | toast="Settings confirmed."; confirmedAt=set; paymentIsLocalTest=false | WORKING — VERIFIED |
| 87 | SET-LOW-STOCK-NO-EFFECT | Settings: "Low-stock alert at (units)" | Changed the store-wide low-stock threshold 10 -> 100 via PATCH /api/admin/settings, then read /api/admin/inventory (then restored 10) | UNKNOWN (code reads variant.low_stock_threshold for alerts) | Low-stock alert count before=1, after=1; variant thresholds still 10 | PARTIALLY IMPLEMENTED |
| 88 | SET-NEGATIVE-DELIVERY | Settings: negative delivery charge | Delivery charge = -3 | Rejected | Could not complete actionDelivery charge must be a number of rupees, 0 or more. | WORKING — VERIFIED |
| 89 | SET-NOCHANGE | Settings: save with no change | Pressed Save changes without editing (the page source changed on disk during the session: toast text, see README) | No request is sent | Toast "No changes to save. Your settings are already saved."; no mutating request was sent (network log: only the login POST) | WORKING — VERIFIED |
| 90 | SET-PHOTOS | Settings: shop photos | Added a shop photo, then removed it | photos 0 -> 1 -> 0 | after add=1; after remove=0 | WORKING — VERIFIED |
| 91 | SET-PIN-VALIDATION | Settings: PIN code validation | Entered "12345, 360001" | Rejected | Could not complete actionPIN codes must be unique 6-digit numbers separated by commas. | WORKING — VERIFIED |
| 92 | SET-SAVE | Settings: save shop + payment details | Changed tagline, UPI id and payee name and saved | Saved; public /store shows new tagline; confirmation withdrawn | toast="Settings saved."; public tagline="Demo tagline for documentation" | WORKING — VERIFIED |
| 93 | SET-WITHDRAW | Settings: changing delivery rules withdraws confirmation | Changed delivery charge to 30 after confirming | Confirmation cleared | confirmedAt=null; deliveryCharges=30 | WORKING — VERIFIED |
