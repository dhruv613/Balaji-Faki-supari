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


---

## Claude Code handoff (appended 2026-10-19; earlier content above is preserved)

Source of truth for this phase: `docs/CLAUDE_PROJECT_AUDIT.md`, `docs/CLAUDE_FINAL_REQUIREMENTS.md`, `docs/CLAUDE_CHANGE_PLAN.md` (section 0 decisions, section 10 progress log), `docs/PRODUCTION_REMEDIATION_RUNBOOK.md` (written, never executed).

**Done (all local commits on `dev/antigravity`, nothing pushed):** local-only isolation; forward-only security migrations (unverified on Postgres); backend P0 fixes; reviews and photos; product details and shop content; public browsing with explicit sign-in/create-account; five-stage order timeline; idempotent payment retry and rejection UI; TEST-vs-real bank evidence; admin guard, dashboard, settings, price management, inventory, customers, feedback moderation; refund-completion safeguard.

**Open items**
1. **Start Docker Desktop (Linux engine), then run the local integration pass**: `supabase start`, `supabase db reset`, `python scripts/check-db-security.py`, backend against Postgres with `python -m app.db.seed --dev --dev-admin`, then the manual walkthrough in README section 3a. Until then Postgres/RLS/Auth/Storage results are NOT VERIFIED and the three `20261020...` migrations must not be called safe.
2. Fill the local Supabase keys into `backend/.env` and `frontend/.env` (empty today); add `SUPABASE_JWT_SECRET` if the local Auth signs HS256 (see `.env.example`).
3. WP11b is blocked on owner decisions (cancellation, refund, reservation expiry, late payments).
4. Owner content still needed before go-live: approved prices (only Faki 1 kg = Rs 1,000 is confirmed), delivery charge, PIN list, real UPI/QR and receiving account, ingredients/production/manufacturer/shelf-life/safety facts, store photos, shop introduction.
5. The archived handoff says the online project may still hold the insecure `simple_db_auth` migration. Not inspected; see the runbook.
6. Cleanup candidates: `frontend/src/features/admin/lib/referenceData.ts` samples (still used as test fixtures and by the hidden Reports/Notifications pages), tracked `backend/New Microsoft Excel Worksheet.xlsx` (contents not inspected).

**Verification at handoff:** `npm run typecheck` PASS; `npm test` (5 suites) PASS; `python -m unittest discover -s backend/tests` 63 tests PASS (SQLite); `node scripts/check-local-only.mjs` PASS. Public pages smoke-tested in the in-app browser against a throwaway SQLite backend (desktop and 375 px). **Not tested:** anything needing local Supabase (sign-up/login, order creation through real Auth, Storage upload, RLS) and the admin screens in a browser.


### Local integration pass (2026-10-19, after Docker started)
- Supabase ports moved to 55320-55329 (Windows reserves 54231-54730). `supabase start` and `supabase db reset` (local) apply all 9 migrations.
- scripts/check-db-security.py: 51/51 PASS on real PostgreSQL (found and fixed: anon policy calling a private function; recursive profile-update policy).
- ORM fixed for PostgreSQL (uuid, jsonb, timestamptz/date types). scripts/smoke-local.py: 57/57 PASS against real local Auth, Postgres and Storage.
- Browser pass: guest draft, create account (no email confirmation), return to review, order creation, QR page with LOCAL TEST notice, admin sign-in, dashboard with real figures and all admin pages rendering.
- NOT done: browser walkthrough of admin actions (approve/confirm/review moderation clicks), WP11b (blocked on owner), re-running npm run verify after the ORM changes (backend suite 63 PASS, frontend suites passed before them).
- Local stack is still running in Docker; stop with `npx supabase stop`. Local admin credentials are in .local-dev-credentials.json (gitignored).

### Screenshot-only payments (2026-10-19, owner request)
- The customer uploads a payment screenshot only (no UTR). The admin sees the screenshot and approves or rejects; no bank-credit details are recorded. Approval still stops at AWAITING_CONFIRMATION. Details and the safeguards given up are in `docs/CLAUDE_CHANGE_PLAN.md` (last section).
- New migration `20261020000003_screenshot_only_payments.sql` (UTR columns nullable; `bank_credits` kept but unused). Apply locally with `npx supabase migration up --local`.
- Refunds still record a bank transfer (not changed; confirm with the owner).
- Verification: `npm run verify` PASS (62 backend tests); `check-db-security.py` 51/51; `smoke-local.py` 58/58 (re-runnable now); browser pass covered customer upload, admin approval, review hide-with-reason.
- Gotcha: Vite on Windows can serve a stale transform after two quick writes; `touch` the file or restart Vite if the page shows an old error.

### Real Faki packet photographs (2026-10-19, owner request)
- Files: `frontend/public/images/products/balaji-faki-packet-front.webp` and `...-back.webp` (1122x1402, lossless WebP converted from the supplied PNGs, pixel-identical, about 1.6 MB each). They were not at those paths when the task started, so they were created from the two attachments (first = front, second = back).
- Data: Faki only (`slug = faki`). `products.image_url` = front; gallery = two `product_images` rows (front position 0, back position 1) whose `storage_path` is the bundled path (a path starting with `/` is served as-is; anything else is a Storage object). Migration `20261020000004_faki_packet_images.sql` (guarded: only if `image_url` is still the old default and the product has no gallery). Dev seed adds the same gallery to a NEW Faki product. Supari and every other image are untouched.
- UI: object-fit contain on a white background everywhere; Product Details has a front/back thumbnail switcher (aria-pressed, labelled); thumbnails added to Order Form, Review Order, My Orders; Order Details and the admin order and product editors use contain. Non-critical images are lazy.
- Nothing assumed: no weight or pack size is tied to the photographed packet, and ingredients, manufacturer, shelf life and certifications stay empty and editable in Admin Product Management. Alt text only says "Faki packet, front/back".
- Check with the owner: the front reads "Soft Cucing of Dry Arecanut" and shows pale slices, while the back shows an orange product. They may be two different packets.
- Verification: `npm run verify` PASS (62 backend tests); smoke 59/59 (new Faki gallery check; the script now removes the photo it uploads); browser desktop and 375 px mobile pass on Home, Product Details (front/back switch), Order Form, Review, My Orders, Order Details, Admin Products and Admin Orders: all image requests 200/304, no horizontal overflow.
- Cleaned up local test data: six leftover 1x1 smoke-test photos on the local Faki record were removed.

### Mitho Mavo and Water Bottle as orderable products (2026-10-19, owner request)
- Catalogue is no longer limited to faki/supari or gram weights: slugs and pack sizes are validated formats (`^[a-z0-9-]{1,32}$`, `^[0-9]{1,4}(g|kg|ml|l)$`) and each product has its own pack sizes. Migration `20261020000005_mitho_mavo_and_water.sql` relaxes the four CHECK constraints and adds the products (applied to the LOCAL database only; nothing deployed).
- Products (defaults chosen by Claude, please confirm): **Mitho Mavo** (`mitho-mavo`, category Faki, description "No Tobacco Faki (Sadi Faki)" as written by the owner, packs 250 g / 500 g / 1 kg like Faki) and **Water Bottle** (`water`, one pack "1 L" taken from the label sheet, no description).
- Prices and stock: the migration creates them UNPRICED with stock 0 (not orderable in production until the owner sets price and stock in Price Management). The explicit dev seed adds clearly badged "Development price" placeholders (Mitho Mavo 150/300/600, Water 1 L = 20) so they can be ordered locally. These numbers are placeholders, not owner data.
- Images: Mitho Mavo = sachet with mavo (main) and two sachets (second); Water = bottle (main) and the flat label artwork (second). The combined bottle + sachet picture is NOT used anywhere (no product owns it). Files are under `frontend/public/images/products/`.
- Not assumed: no ingredients, weights, certifications or claims were entered for either product. The water label sheet lists ingredients, manufacturer (VIBEUP FOODS AND BEVERAGES LLP), FSSAI licence, "B12 added" and storage text; none of it was copied into product facts. Enter it in Admin Product Management only after the owner confirms it. The label artwork is shown as a gallery photo and can be removed in Admin > Products > Photos.
- Code: backend schemas use format-validated strings, pack sizes sort by quantity (`_pack_sort_key`), catalogue order is creation order; frontend types are strings, `formatPackSize` handles g/kg/ml/L, a stale saved draft falls back to a real product and pack size, the reviews filter lists the catalogue.
- Verification: `npm run verify` PASS (66 backend tests incl. new `test_catalog_products.py`); `check-db-security.py` 51/51; `smoke-local.py` 63/63 (water quote, order and cancel on Postgres; wrong pack for a product refused); browser: Home (4 cards), Product Details with galleries, Order Form (query preselect, per-product pack sizes), Review, order created for Water, My Orders, Admin Products and Inventory, no horizontal overflow at 375 px.
- Still Faki/Supari-only copy: the page title and meta description ("Fresh Faki & Supari Online"), the hero buttons, the unrouted Reports sample data.

### Product card opens full details on the same page (2026-10-19, owner request)
- Clicking any product card (or its "View details & reviews" button) on the home page opens a dialog with the full product details and the Order button, without leaving the page. The card's own Order button still goes straight to the order form.
- `ProductDetailsView` (photos with front/back switcher, description, pack sizes and prices, owner-supplied facts, reviews, Order button) is shared by the dialog and the `/products/:slug` page, which stays as a deep link. New `components/common/Modal.tsx`: Escape, backdrop click and Close button close it; focus is trapped and returned to the opener; page scroll is locked; full-screen on phones.
- Ordering from the dialog preselects the product and chosen pack size on `/order`.
- Verification: typecheck, `npm run verify` (5 frontend suites, 66 backend tests), browser: open from the card name, image and button, photo switch, pack choice, Esc and backdrop close, order handoff, card Order link unaffected, deep link page unchanged, mobile 375 px full-screen with no overflow.

### Faki real photos; arecanut packet moved to Supari (2026-10-19, owner request)
- The packet front/back photos installed earlier on Faki are the arecanut packet ("Soft Cucing of Dry Arecanut"), so they now belong to **Supari** (files renamed `balaji-supari-packet-front/back.webp`). This resolves the earlier "check with the owner" note about the front/back mismatch.
- **Faki gallery order:** (1) `balaji-faki-bundle.jpg` tied sachet bundle (also the card image), (2) `balaji-faki-box.webp` box, (3) `balaji-faki-banner.jpg` promotional banner last. **Supari gallery:** its existing bowl photo first, then packet front and back last (Supari's card image is still the bowl; swap the order in Admin > Products > Photos if the packet should lead).
- Migration `20261020000006_faki_real_images_supari_packet.sql` (local DB only) moves the two rows and adds Faki's three; an owner-edited gallery is never replaced. Dev seed matches. Gallery frame is now square so portrait and landscape photos both fit.
- Flags for the owner: the banner promises "All India Courier Service FREE with Order 50 FAKI Parcel" and "Natural Taste Until 30 DAYS" while the site only serves the local PIN list and no delivery charge is decided; it also carries a Windows "Activate Windows" watermark in the bottom-right corner (re-export it without that). The bundle photo has wide white margins, so the sachet looks small in its frame. The box reads "25 PCS" and the banner "50 FAKI Parcel": Faki may be sold by pieces rather than the 250 g / 500 g / 1 kg packs, which is not changed here.
- Verification: `npm run verify` PASS (66 backend tests), smoke 64/64 (Faki and Supari gallery order), browser: card images and both dialogs show the galleries in the stated order with the right files.

### Faki photo order swapped (2026-10-19, owner request)
- Faki gallery is now: (1) box (also the card image), (2) tied sachet bundle, (3) promotional banner last. Migration `20261020000007_faki_gallery_order.sql` (local DB only, applies only if the gallery is still as left by the previous migration); dev seed and tests match. This supersedes the order stated in the previous section.

### Chuno added as an orderable product (2026-10-19, owner request)
- New product `chuno` (name "Chuno", Gujarati ચુનો, category "Chuno", no description). Migration `20261020000008_chuno.sql` (local DB only) creates it UNPRICED with stock 0, so it is not orderable in production until the owner sets price and stock in Price Management. The dev seed adds badged placeholder prices (250 g 50, 500 g 90, 1 kg 160) so it can be ordered locally; they are placeholders, not owner data.
- Pack sizes 250 g / 500 g / 1 kg are my default (same as Faki and Mitho Mavo), **not confirmed**: the photos show small sachets and a "parcel", so the real sizes may be small weights or counts. Tell me the real sizes and prices.
- Photos in the order supplied: (1) the pile of sachets with one in front (card image), (2) yellow banner with the pile and "ચુના પાર્સલ", (3) yellow banner with one sachet. Both banners carry the store's WhatsApp number and Instagram handle and a Windows "Activate Windows" watermark in the bottom-right corner (re-export them without it).
- Nothing about ingredients, weight or claims was entered. The sachets read "Special Fodelo Chuno" in Gujarati; that wording was not copied into the product facts.
- Verification: `npm run verify` PASS (66 backend tests), DB security 51/51, smoke 65/65 (Chuno in the catalogue with three photos), browser: five cards, Chuno dialog with all three photos, order from the dialog preselects Chuno and the 500 g pack.

