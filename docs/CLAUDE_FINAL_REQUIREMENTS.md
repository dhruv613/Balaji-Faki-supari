# Balaji Faki Point — Final Requirements (Phase 2)

- **Date:** 2026-10-19 · **Branch:** `dev/antigravity` (checkpoint `7587029`)
- **Source:** owner's Phase 2 brief + `docs/CLAUDE_PROJECT_AUDIT.md`. This file restates what must be true; `docs/CLAUDE_CHANGE_PLAN.md` says how to get there.
- **Scope:** local development only (React/TS/Vite · FastAPI · local Supabase Postgres/Auth/Storage). No remote Supabase, no Vercel deploy, no real payments.
- **Labels:** **DECIDED** (owner stated) · **DEFAULT** (my proposal, proceeds unless the owner objects) · **ASK** (needs the owner before it is built).

---

## 1. Purpose
Online ordering of Faki and Supari. Customer journey: browse → understand ingredients, qualities, prices → read genuine reviews → order → pay externally by UPI QR → upload screenshot + 12-digit UTR → wait for manual payment verification → order confirmation → follow packing/delivery inside My Orders. Amazon/Flipkart are references for familiar behaviour only; no copied assets. Keep the existing orange/cream Balaji Faki Point design.

## 2. Decisions already made (DECIDED)
1. Work is protected by local git commits; nothing is pushed.
2. Home, Store, Help and Reviews are publicly viewable; login is needed only to order, view personal orders, submit feedback or other protected actions.
3. Local signup must not require email confirmation.
4. Only **Faki 1 kg = ₹1,000** is a confirmed price.
5. Primary admin navigation has exactly four modules: Dashboard, Price Management, Order Management, Feedback Management.
6. Production Supabase and Vercel are never modified. No legacy database-password authentication.
7. Only `OWNER_ADMIN` can perform admin actions.

## 3. Customer requirements

| ID | Requirement |
|---|---|
| C-01 | **Home (public).** Primary actions *Order Faki* and *Order Supari*. Shows product images, available products, current prices from the database, descriptions, real aggregate ratings, shop introduction, contact/help. No login wall. |
| C-02 | **Product details (public).** Name, images, category, pack sizes, price, ingredients, description, what makes it distinctive/popular, characteristics, preparation/production, manufacturer/provider, packaging, storage, shelf life (where known), applicable safety disclosures, ratings + reviews. A field with no owner-supplied value is **not rendered** and never invented. |
| C-03 | **Prices.** Every real price comes from PostgreSQL and is admin-editable. Faki 1 kg = ₹1,000 is confirmed. All other seeded prices are **development data**, labelled as such until the owner approves them. |
| C-04 | **No silent defaults.** `GET /products`, checkout quotes and normal orders never create or restore prices, stock, products or settings. Defaults exist only through an explicit development-initialisation command. |
| C-05 | **Authentication (Supabase Auth).** New registration, existing login, persistent session, password verification, protected order data, profile update. Public browsing never needs a session. Order draft survives the login step. |
| C-06 | **Safer "Continue" flow.** A mistyped email must not silently create an account. Exact UX in §7 (**ASK** before changing the established Continue behaviour). |
| C-07 | **Ordering.** Choose Faki/Supari, weight, quantity. Collect full name, contact number, delivery address, PIN code, optional notes. Review Order shows backend-calculated prices and any delivery charge. Order is persisted by FastAPI in local PostgreSQL. Duplicate submissions are prevented. |
| C-08 | **QR payment.** Shows the shop's configurable QR and the exact order amount. Customer submits screenshot + 12-digit UTR. Proof goes to private local Supabase Storage; payment data to PostgreSQL. On success show **"Payment Verification Pending"**. Screenshot submission is never presented as payment success. Local testing uses explicit LOCAL TEST payment settings (see §6). |
| C-09 | **Rejection and retry.** A rejected proof shows the admin's reason and an eligible customer can submit a new attempt. Earlier attempts stay in history. Retries are idempotent (same attempt can be replayed safely; a double click never creates two attempts). |
| C-10 | **My Orders → Order Details** (no standalone Track page, no Track nav item; `/track*` redirects). Shows product image, name, weight, quantity, order ID, price, payment status, delivery address, current status, vertical progress timeline with real timestamps, help/support. Customer timeline: **Order Confirmed → Packed → Shipped → Out for Delivery → Delivered**; before confirmation it shows the correct payment-verification state. Detailed backend states and shipment history stay. |
| C-11 | **Reviews.** Publicly readable with average rating, 1–5 star distribution, genuine review count, written reviews, optional photos, date, *Verified Purchase* when justified, sorting. Only the owner of a **DELIVERED** order can review it, once per order item. Photos are private in Storage with authorised access. Genuine negative reviews are never removed for being negative. |
| C-12 | **Our Shop (public).** Shop name and introduction, real store photos, location, contact, preparation/production information, provider/manufacturer, packaging. All owner-editable; nothing invented (no fake certifications, ratings or addresses). |
| C-13 | **Help/FAQs (public).** Static content is acceptable, but contact details come from the store profile, not hard-coded literals. |

## 4. Order and payment rules (server-enforced)

**Payment:** `PENDING → SUBMITTED → UNDER_REVIEW → VERIFIED`; `SUBMITTED/UNDER_REVIEW → REJECTED`. After rejection history is retained and a new attempt is allowed.
**Order:** `PENDING_PAYMENT → PAYMENT_REVIEW → AWAITING_CONFIRMATION → CONFIRMED → PACKING → PACKED → PICKED_UP → SHIPPED → OUT_FOR_DELIVERY → DELIVERED`; exceptions `CANCELLED`, `DELIVERY_FAILED`.

| ID | Rule |
|---|---|
| R-01 | Proof submission does not verify payment. |
| R-02 | ~~`VERIFIED` requires independent matching bank-credit evidence.~~ **Superseded 2026-10-19 (owner): `VERIFIED` is set by the owner after viewing the customer's uploaded screenshot; no UTR or bank record.** |
| R-03 | Payment approval does not confirm the order; the admin confirms separately. |
| R-04 | No fulfilment (packing and later) before verified payment **and** confirmed order. |
| R-05 | Every transition is validated on the server; status history keeps timestamp and actor. |
| R-06 | Inventory and refunds stay consistent with state (reserve → deduct on confirm → release/restore on cancel). Reservations must not be held forever (§5, A-10). |
| R-07 | Audit logs, payment records and existing customer/order data are preserved by every change. |

## 5. Admin requirements

| ID | Requirement |
|---|---|
| A-01 | **Navigation:** exactly Dashboard, Price Management, Order Management, Feedback Management. Supporting screens (payments, delivery, refunds, inventory, customers, settings) are reachable from those pages or as contextual secondary routes, never as extra top-level items. |
| A-02 | **Dashboard:** exactly *Products Sold*, *Net Profit*, and a *Pending Payment Confirmations* table. No other cards or charts. Real data only. Net Profit is shown only when product costs (and the other inputs) exist; otherwise "Not available" with the reason — no fictional profit. |
| A-03 | **Price Management:** products, Faki/Supari variants, selling and cost prices, stock, images, ingredients, descriptions, preparation details, availability. Price changes affect **future orders only**. A partial update must never clear a price or re-enable a variant. |
| A-04 | **Order Management:** view orders; inspect screenshot + UTR; verify/reject payment; confirm separately; update packing; update shipping/delivery; assign a delivery person; handle eligible cancellations/refunds; view order history. |
| A-05 | **Feedback Management:** view reviews and product ratings, inspect photos securely, moderate spam, reply, preserve legitimate negative reviews. |
| A-06 | **Inventory (required):** integrated with product/stock management; adjustments recorded as stock movements. |
| A-07 | **Customers (required, read-only):** basic customer and order information. |
| A-08 | **Settings (required):** legitimate shop details, payment configuration (UPI ID/payee/QR), delivery charge/threshold, serviceable PINs, business information. No sample values anywhere; failed loads must never allow saving placeholders. |
| A-09 | **Reports and Notifications (optional for local completion).** Not shown as working features while unfinished (§8). |
| A-10 | **Stock reservations** expire safely (policy in `CLAUDE_CHANGE_PLAN.md` §6). |

## 6. Confirmed vs unconfirmed business data

| Item | Status | Handling |
|---|---|---|
| Faki 1 kg = ₹1,000 | **Confirmed** | Seeded as confirmed. |
| Faki 250g/500g; Supari 250g/500g/1kg | Unconfirmed (dev data: ₹250/₹500; ₹200/₹400/₹800) | Seeded only by the explicit dev command, flagged "development price – not approved", visible as such in admin and in local UI. |
| Cost prices (seed ₹90–₹360 range) | Unconfirmed | Dev data; Net Profit must say it uses unapproved dev costs, or be hidden, until confirmed. |
| Stock (seed 50 per variant) | Unconfirmed | Dev data only. |
| Delivery charge / free-delivery threshold (seed ₹0 / 0) | Unconfirmed | Flagged unapproved; never silently treated as approved. |
| Serviceable PIN codes (seed 360001–360007) | Unconfirmed | Editable; flagged until approved. |
| UPI ID / payee / QR image | **LOCAL TEST** | Explicit test values, obviously fake, banner on payment page and in Settings. The existing seed contains a real-looking UPI ID; it is not treated as verified and is replaced by test values. |
| Ingredients, characteristics, production/packaging, manufacturer, shelf life, safety/storage | Not supplied | Blank, owner-editable, not rendered when empty. |
| Shop address / hours | Address from the existing public page is retained but marked "owner to confirm"; hours = "call the store". | Owner-editable. |
| Support phone / WhatsApp (`+91 80009 61030`) | Appears throughout the repo; INFERRED real | Move to the store profile; owner to confirm. |
| Support email (`support@balajifakipoint.com`, a model default) | Possibly invented | Remove default; blank until supplied. |
| Store photos, product photos beyond current bundled images | Not supplied | Upload via admin when provided. |

A **go-live guard** (DEFAULT): outside local mode, checkout stays disabled until the owner has confirmed payment/delivery settings and every sellable price in admin.

## 7. Authentication UX proposal (**ASK** — nothing changes until approved)

Problem: today's single *Continue* tries sign-in, and on "invalid credentials" silently calls sign-up, so a mistyped email creates a new account.

Proposal (keeps one simple screen):
1. **Sign in** (default): Email, Password, **Continue** = sign-in only. Wrong credentials → "Email or password is incorrect." plus a link "New here? Create an account with *typed-email*" (switches to registration with the email pre-filled).
2. **Create account:** Email, **Confirm email** (typed again), Password (show/hide), Full name, Indian mobile (merges today's separate "Your details" step), **Create account**. Existing email → "An account already exists for this email — sign in instead."
3. Locally, email confirmation is off, so a session starts immediately and the customer returns to what they were doing (`next` path), e.g. Review Order.
4. **Forgot password** link using Supabase reset (local emails land in the local mail catcher). Optional; DEFAULT include.
5. Profile update: a small *Account* page (name, mobile) reusing the existing profile sync.

Trade-off: sign-up still reveals whether an email exists (same as today and typical for retail); the gain is that a typo can never create an account.

## 8. Optional modules (recommendation)
Hide **Reports** and **Notifications** until implemented: remove their routes (or redirect to Dashboard) and keep the page files and database tables (notifications are still written). Order and payment status already appear in Order Management, so no required information is lost. Revisit after the required scope passes.

## 9. Security and data-safety requirements

| ID | Requirement |
|---|---|
| S-01 | Final database state has no password hash in any exposed table, no permissive `using(true)` policies, no self-promotion path to admin; verified by an executable SQL check after a clean `supabase db reset`. |
| S-02 | The role guard must not depend on a PostgREST setting that may not exist (`request.jwt.claim.role`). |
| S-03 | Local tooling cannot reach production: no tracked config or env points at the remote project; CLI link and MCP are isolated (procedure in the change plan §3). |
| S-04 | Payment proofs and review photos stay in private buckets; every read is authorised; signed URLs are short-lived. |
| S-05 | The frontend never receives the service-role/secret key; `.env` values are never printed or committed. |
| S-06 | Fix known bugs that corrupt money or stock: notification CHECK mismatch, PIN type mismatch, partial-update price clearing, never-expiring reservations, unhandled delivery transition error. |
| S-07 | Existing data is migrated forward only; applied migrations are not rewritten (the remote project may have applied them). |

## 10. Local development requirements

| ID | Requirement |
|---|---|
| L-01 | `supabase start` brings up local Postgres (54322), Auth/API (54321) and Storage; `supabase db reset` rebuilds the schema from migrations cleanly. |
| L-02 | `.env` files hold local keys obtained from the local stack; no remote URLs. |
| L-03 | Backend runs against local PostgreSQL (`psycopg` installed), verifies local Supabase JWTs, and stores files in local Storage buckets. |
| L-04 | A repeatable smoke test proves: sign-up/login, order, proof upload, admin approval/confirmation, delivery, review with photo — against real local services. |
| L-05 | A dev-data command seeds clearly-labelled development products/prices/settings on demand only. |

## 11. Out of scope for this phase
Deployment, remote Supabase changes, real payments, automatic UPI/bank reconciliation, multi-item carts, courier-API integration, email/SMS/WhatsApp sending, Reports and Notifications UI, any redesign of the orange/cream theme.

## 12. Open business questions (summary)
1. Approve the sign-in/sign-up UX in §7.
2. Cancellation, refund and unpaid-order expiry policy (proposed defaults in the change plan §6) — money rules.
3. Review publishing: publish immediately and moderate afterwards (DEFAULT) vs approve-before-publish.
4. Approve the local-isolation edits (change plan §3) and decide whether to prepare a **production remediation runbook** (prepared, never executed) because the remote project may still hold the insecure migration.
5. Owner-supplied content still needed before go-live: approved prices, delivery charge, real UPI/QR and receiving account, ingredients and production facts, store photos.
