# Balaji Faki Point — Active Codex Task

## Requirements

**Main purpose:** Customers order Faki and Supari.

**Customer flow:** Select Product → Enter Details → Review Order → UPI QR → Screenshot + UTR → Pending Verification → Admin Payment Approval → Separate Order Confirmation → Packed → Shipped → Out for Delivery → Delivered.

**Payment states:** `PENDING → SUBMITTED → UNDER_REVIEW → VERIFIED`.

Alternative: `SUBMITTED / UNDER_REVIEW → REJECTED`.

**Order states:** `PENDING_PAYMENT → PAYMENT_REVIEW → AWAITING_CONFIRMATION → CONFIRMED → PACKING → PACKED → PICKED_UP → SHIPPED → OUT_FOR_DELIVERY → DELIVERED`.

Critical rules:

- Screenshot submitted does not mean payment verified.
- Payment verified does not mean order confirmed.
- Admin checks actual bank credit before approval.
- Backend enforces valid state transitions.
- Customer order updates appear inside My Orders → Order Details.
- Remove standalone customer tracking navigation, but preserve backend tracking history.
- Homepage must prominently show Order Faki and Order Supari.
- Faki 1 kg = ₹1,000, stored in the local database and editable by admin.
- Product details, real reviews and Our Shop information are required.
- Preserve existing UI, orange/cream branding and security architecture.
- Local development only; no production deployment.

## Workspace evidence

- Active local source: `D:\D&D Projects\Balaji Faki Website`.
- Git branch: `dev/antigravity`.
- Source files are readable and writable from this session.
- Git working-tree status and diff are currently blocked by `fatal: this operation must be run in a work tree`; no reset, clean, stash, commit, or other destructive Git operation will be used.

## Completed

- Identified the active local app as a different checkout from the initial C: workspace.
- Added temporary local Faki and Supari prices: Faki 1 kg is ₹1,000; all values remain admin-editable database prices.
- Removed the visible standalone **Track** navigation item and replaced its customer page with **My Orders → Order Details**. Legacy `/track` URLs redirect safely.
- Added the canonical `PENDING → SUBMITTED → UNDER_REVIEW → VERIFIED` payment-attempt transitions. Independent Owner Admin review is required before approval, and approval still ends at `AWAITING_CONFIRMATION`.
- Preserved rejected proof evidence and let the customer submit a new attempt only after the order returns to `PENDING_PAYMENT`.
- Added row locks for payment review, approval, confirmation, fulfilment, cancellation, and stock changes; retained immutable paise order-item prices and unique bank-credit references.
- Added customer/admin cancellation guards, exactly-once inventory release, pending-refund creation for verified payments, and Owner Admin refund approval/verified-transfer completion actions.
- Verified existing Supabase JWT checks, owner/admin guards, audit history, shipment history, and product-price persistence design.
- Replaced sample customer reviews with persisted, product-filtered published reviews. Only the owner of a delivered order can submit one verified-purchase review; it remains pending until an Owner Admin publishes or hides it.
- Added review moderation/reply persistence and audit entries, and removed fake review rows from the home and admin feedback screens.
- Made the homepage hero's primary actions **Order Faki** and **Order Supari** and clarified that payment verification happens before separate shop confirmation.
- Added persisted product image data to customer order responses and show it in **My Orders → Order Details**.
- Kept public product information limited to admin-entered, store-confirmed details; removed the unsupported two-minute ordering promise and invented fallback Faki/Supari descriptions.
- Added temporary local prices through the canonical catalog seed: Faki 250g/500g/1kg = ₹250/₹500/₹1,000 and Supari 250g/500g/1kg = ₹200/₹400/₹800.
- Required a meaningful delivery-failure reason in both the dedicated delivery action and the existing admin status action, then persist it with shipment, status-history, and delivery-event records.
- Verified approval and confirmation idempotency, duplicate bank-credit rejection, and status persistence after reopening the database engine through the FastAPI HTTP workflow.
- Added optional, admin-entered product fields for ingredients/composition, popularity, characteristics, production/packaging, provider/manufacturer, and safety/storage. They remain blank until the shop supplies confirmed facts; the public catalogue only renders populated fields.
- Added `supabase/migrations/20261019000000_product_information.sql` for those product fields and wired the existing Owner Admin product editor to save them.
- Replaced the payment-proof filesystem fallback with the existing local Supabase private `payment-proofs` bucket. A payment attempt moves to `SUBMITTED` only after its proof upload succeeds; storage failures return a retry-safe `503` before any state change.
- Removed the remote QR-logo fallback. Customers now see a payment QR only when the local store configuration has an actual configured QR asset.
- Moved the existing shop address and opening-hours disclaimer into the canonical `StoreSettings` seed, added the public `/api/store` profile response, and changed **Our shop** to read it rather than hard-code contact data. The public response deliberately excludes UPI and QR settings.
- Removed the obsolete remote staging verification script and remote Supabase project configuration from the local verification path. Historical Antigravity remote instructions are marked archived.

## In progress

- The local Supabase migration and private Storage smoke checks require Docker Desktop's Linux engine. No production service has been contacted.

## Remaining

- Complete browser-level local-server verification when browser access is available.
- Run `20261019000000_product_information.sql`, PostgreSQL, and private Supabase Storage smoke checks after Docker Desktop's Linux engine is running and a local-only database connection is configured. No remote Supabase project was used.
- Add private customer-review photo support with an explicit local Storage bucket and moderation path; it is not yet in the `reviews` schema.
- Obtain confirmed product composition, characteristics, production/packaging, provider/manufacturer, safety/storage details, store photos, and the actual QR asset before publishing them.

## Files changed

- `frontend/src/components/layout/Header.tsx`
- `frontend/src/app/router.tsx`
- `frontend/src/features/orders/pages/MyOrdersPage.tsx`
- `frontend/src/features/orders/pages/OrderDetailsPage.tsx`
- `frontend/src/features/orders/pages/OrderConfirmationPage.tsx`
- `frontend/src/features/orders/api/ordersApi.ts`
- `frontend/src/types/orders.ts`
- `frontend/src/lib/api.ts`
- `frontend/src/features/admin/api/index.ts`
- `frontend/src/features/admin/pages/AdminPaymentsPage.tsx`
- `frontend/src/features/admin/lib/orderStateMachine.ts`
- `frontend/src/features/admin/types/index.ts`
- `frontend/src/features/help/pages/HelpFAQsPage.tsx`
- `frontend/src/features/catalog/pages/HomePage.tsx`
- `frontend/src/features/store/pages/VisitStorePage.tsx`
- `frontend/src/features/reviews/pages/CustomerReviewsPage.tsx`
- `frontend/src/features/reviews/reviewsApi.ts`
- `frontend/src/features/admin/pages/AdminReviewsPage.tsx`
- `frontend/src/features/admin/pages/AdminProductsPage.tsx`
- `frontend/src/features/admin/lib/referenceData.ts`
- `frontend/src/lib/contracts.ts`
- `frontend/src/types/orders.ts`
- `frontend/src/styles/globals.css`
- `backend/app/core/domain.py`
- `backend/app/core/storage.py`
- `backend/app/main.py`
- `backend/app/schemas.py`
- `backend/app/db/models.py`
- `backend/app/db/seed.py`
- `supabase/migrations/20261019000000_product_information.sql`
- `backend/tests/test_api_workflow.py`
- `backend/tests/test_payment_state_machine.py`
- `backend/tests/test_cancellation_service.py`
- `backend/tests/test_review_service.py`
- `backend/tests/test_catalog_details.py`
- `backend/tests/test_supabase_storage.py`
- `backend/tests/test_delivery_state_service.py`
- `frontend/src/features/store/storeApi.ts`
- `docs/CODEX_ACTIVE_TASK.md`

## Tests

- Passed this session: `backend/tests/test_catalog_details.py` (3 tests), `backend/tests/test_supabase_storage.py` (4 tests), `frontend/tests/checkout.test.mjs`, and `npm --prefix frontend run typecheck`.
- Blocked: the existing FastAPI `TestClient` workflow test stalls before its first request because this managed Windows environment blocks the socket pair that AnyIO creates. The stack trace stops in Python's standard-library `socket.accept`, before application code. Local PostgreSQL and live private Supabase Storage checks also remain blocked because Docker Desktop's Linux engine is not running.

## Next exact action

Run the local migration and workflow suite on a Windows environment that permits AnyIO sockets, then smoke-test the local Supabase Storage upload. Next implementation work is customer review-photo storage and moderation, followed by adding only owner-confirmed store/product facts.
