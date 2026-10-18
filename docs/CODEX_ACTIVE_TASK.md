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

## In progress

- The remaining product/shop data needs business confirmation before it can be published.

## Remaining

- Complete browser-level local-server verification when browser access is available.
- Run PostgreSQL and private Supabase Storage verification after Docker Desktop's Linux engine is running and a local-only database connection is configured. No remote Supabase project was used.
- Review the retained-template system design document requirement and remaining product/review/shop content separately from the state-machine work.
- Add private customer-photo support only after the business supplies a storage and moderation policy; the current `reviews` schema has no photo field.
- Obtain confirmed product composition, characteristics, production/packaging, provider/manufacturer, safety/storage details, and store photos before adding them to the catalog or shop page.

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
- `backend/app/main.py`
- `backend/app/schemas.py`
- `backend/app/db/seed.py`
- `backend/tests/test_api_workflow.py`
- `backend/tests/test_payment_state_machine.py`
- `backend/tests/test_cancellation_service.py`
- `backend/tests/test_review_service.py`
- `backend/tests/test_catalog_details.py`
- `backend/tests/test_delivery_state_service.py`
- `docs/CODEX_ACTIVE_TASK.md`

## Tests

- Passed: Python AST validation; 19 backend tests including the FastAPI HTTP lifecycle, idempotent payment approval/order confirmation, duplicate bank-credit rejection, rejection-and-retry, cancellation/refund consistency, inventory rollback, delivery-failure persistence, and reopened-database status persistence; frontend typecheck and test suite; Vite production build.
- Blocked: local PostgreSQL and private Supabase Storage checks. `npx supabase status` confirmed Docker Desktop's Linux engine is not running, and no local `DATABASE_URL` is configured. Browser automation is unavailable in this session.

## Next exact action

Start Docker Desktop's Linux engine, configure only the local Supabase connection, and run the PostgreSQL/private-storage smoke checks; then add only store-confirmed product/shop facts and photos through the existing admin catalog fields.
