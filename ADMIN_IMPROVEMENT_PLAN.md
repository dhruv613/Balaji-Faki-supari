# Admin Panel — Improvement Plan (audit of the current working tree)

**Status: PLAN ONLY. No application code was changed for this document.** Nothing below is implemented until the owner issues an explicit implementation GO naming task IDs.
**Updated 2026-10-21** to record owner decisions D-01…D-05 (section 0). The binding, task-by-task specification is **`ADMIN_APPROVED_SCOPE.md`**; this file remains the audit + backlog.
**Labels** (from the project rules): **VERIFIED** = confirmed in code/tests/command output now · **INFERRED** = strongly suggested, not confirmed · **UNKNOWN** · **NEEDS CONFIRMATION** = owner decision.
Finding status values requested by the review prompt: `confirmed current` · `already fixed` · `needs verification`.

---

## 0. Latest owner decisions (2026-10-21) — authoritative, supersede anything below that conflicts

| ID | Decision | Task | State |
|---|---|---|---|
| D-01 | Payment stays **screenshot-only, manually approved**. Add a SHA-256 **duplicate-screenshot warning** for the admin. Never auto-reject/approve, never label fraud, no mandatory UTR / transaction ID / bank statement. Payment + order state machines unchanged. Wrong-amount and duplicate-actual-transfer handling **undecided**. | T-B1 (Q1 → option a) | policy APPROVED · coding not authorized |
| D-02 | Reservation expiry stays **disabled**: no auto-cancel, no time-based stock release, no cron/background job. Misleading expiry text to be **proposed** (not implemented). | T-B2 closed (no-op); wording = T-A5 | APPROVED (keep disabled) |
| D-03 | Exactly **five primary** links stay (Dashboard, Price Management, Order Management, Feedback Management, Settings) + a separate compact, accessible **Operations** group: Payments, Inventory, Delivery, Customers, Refunds; desktop and mobile. | T-A10 (Q6) | APPROVED · UI details + coding GO pending |
| D-04 | Cancel after `DELIVERY_FAILED`: admin makes **two separate choices** — stock disposition (returned-sellable / damaged / lost-not-returned) and refund amount (case by case). No assumed full refund; damaged/lost never return to sellable; sellable return needs physical-return confirmation + audit; refund stays an external manual bank-transfer ledger. | T-B3 (Q3) | APPROVED in principle · edge rules unresolved → BLOCKED |
| D-05 | This round = planning only. | all | — |

Effect on the backlog below: **T-B1** narrows to Option (a) only (hash warning); Options (b)/(c) are dropped. **T-B2** is not built (kept as a historical note). **T-A10** adopts the grouped design. **T-B3** is re-scoped to the two-choice cancel dialog. Everything not named in D-01…D-04 is still a *proposal* (T-A5…A9 except as noted, T-B4…B7, T-C1…C4). Nothing is authorized to be coded until a GO lists task IDs.

---

## 1. What changed since the demo snapshot

| Check | Result |
|---|---|
| Git HEAD | still `0a69f7e` (no new commits) — VERIFIED |
| Fingerprint of admin pages + `orderStateMachine.ts` + backend `routes/` + `core/` | **identical** to the snapshot (`sha256 fb6eab5a…630a`) → none of the audited behaviour changed — VERIFIED |
| Uncommitted files | the same 18 modified files as at snapshot; `git diff --stat` for `admin.css` (−21), `globals.css` (−78), `AdminSettingsPage.tsx` (+34), `storage.py` (+36) unchanged — VERIFIED |
| `AdminSettingsPage.tsx` | still carries the **other actor's uncommitted edit** (toast for "no changes", renamed error banner, `confirm()` guard, `applyMediaUpdate`). Not mine; must not be overwritten. |
| New untracked | `BALAJI_ADMIN_DOCUMENTATION/` and `BALAJI_ADMIN_DOCUMENTATION.zip` (30 MB) at the repo root |
| Servers | the demo servers were stopped; the demo SQLite DB and capture scripts live outside the repo (scratch folder) |

**Consequence:** every finding below was re-checked against current source, not copied from the report.

---

## 2. Two corrections to the independent review (read before approving anything)

### 2.1 "P0 — payment needs a UTR / settlement proof" is **already an owner decision, in the other direction**
- `docs/CLAUDE_CHANGE_PLAN.md` (§"Owner decision, 2026-10-19: screenshot-only payment approval") — owner instruction: *remove bank verification; the admin only sees the screenshot*. It explicitly lists the **dropped safeguards accepted by the owner**: duplicate-UTR / duplicate bank-reference detection and amount matching, and states "a forged or reused screenshot is now caught only by the admin's eyes. Suggested later, only if wanted: hash each screenshot and warn on reuse."
- `docs/CLAUDE_FINAL_REQUIREMENTS.md` R-02 is struck through with the same supersession; `submitted_utr` was made nullable by a migration; the `bank_credits` table is intentionally kept but unused.
- The review's "earlier customer-site reference asks for UTR" refers to the pre-decision design reference / requirement C-08. **VERIFIED**: the current storefront payment flow is screenshot-only (`frontend/src/features/payments/pages/PaymentFlowPage.tsx:6-7`, `QRPaymentPage.tsx`).
- **Real, confirmed defect that this surfaces:** the storefront home page still says *"Scan, pay the exact amount and **enter your transaction ID**."* (`frontend/src/features/catalog/pages/HomePage.tsx:102`) although no transaction-ID field exists. Customer-facing copy contradicts the flow. (confirmed current)
- **What this means for the plan:** the review's recommendation re-opens a decision the owner already made. The risk it names is real (a forged screenshot can be approved — VERIFIED R-PAY-06) but it is a **new owner decision** (Q1), not a defect. Cheap, decision-compatible mitigations exist that keep screenshot-only approval (see T-B1).
- **RESOLVED 2026-10-21 (D-01):** owner confirmed screenshot-only + SHA-256 duplicate warning (non-blocking). UTR/bank-statement options are rejected.

### 2.2 Reservation expiry was explicitly **withdrawn and blocked** by the owner
- `docs/CLAUDE_CHANGE_PLAN.md` item 6: "The proposed 30-minute auto-cancel is **withdrawn** … Until approval: no automatic order cancellation, no change to customer cancel rules, no refund policy changes." Four decisions are still open there (reservation window and whether a lapse only releases stock; who may self-cancel at which stage; refund rules incl. delivery-failed; late payments when stock is gone).
- So the missing expiry job is **intentional-pending**, and the Settings page text says so. Display of "Reservation Expiry Policy: 30 mins" is still misleading (T-A5). Implementation stays blocked on Q2.
- **RESOLVED 2026-10-21 (D-02):** owner kept expiry **disabled**. Nothing to build; only the wording fix (T-A5) remains a proposal.

### 2.3 The five-link sidebar is deliberate
`admin-panel/tests/admin.test.mjs:467-478` asserts the sidebar is **exactly** Dashboard, Price Management, Order Management, Feedback Management, Settings (`deepEqual`), and the dashboard test is titled "minimal Dashboard". `App.tsx` comments: "Preserved additional admin routes" and "Reports and Notifications are hidden until built". Adding nav links reverses a deliberate trim → needs a quick owner yes (Q6) and a test update; it is not a pure bug fix.
- **Working-tree fact (VERIFIED, `git diff`):** at HEAD the sidebar has **four** links; the fifth (`Settings`) is part of the *uncommitted* edit of `AdminSidebar.tsx` (+1 line) — so the "five-link" state itself belongs to the 18 uncommitted files and the matching `admin.test.mjs` hunk is also uncommitted.
- **RESOLVED 2026-10-21 (D-03):** owner approved keeping exactly those five primary links and adding a separate **Operations** group (Payments, Inventory, Delivery, Customers, Refunds). The test is to be changed from "sidebar has exactly 5 entries" to "5 primary entries unchanged + Operations group with 5 named entries".

---

## 3. Finding-by-finding verification

| # | Review finding | Status | Evidence (current tree) |
|---|---|---|---|
| 1 | Payment proof = screenshot only; forged image possible | **confirmed current — but owner-accepted** | `routes/admin_payments.py:272-366` (approve compares nothing); `routes/payments.py` (no UTR input); change plan §owner decision 2026-10-19 |
| 2 | Reservation expiry displayed, never enforced | **confirmed current — intentionally blocked** | `stock_reservation_expires_at` only written/read in `routes/orders.py:53,174,192`; no cron in `vercel.json`/`admin-panel/vercel.json`; no job module in `backend/app` |
| 3 | Delivery / Customers / Refunds have no UI link | **confirmed current** | `AdminSidebar.tsx:16-27` (5 items); grep of `admin-panel/src` finds no `Link`/`to=` to those routes |
| 4 | Customer counters do not reverse on cancel | **confirmed current** | `admin_orders.py:334-338` increments at confirm; `common.py:_cancel_order` never touches `customers`; runtime test CUST-COUNTERS-AFTER-CANCEL (3→3, ₹2,400→₹2,400) |
| 5 | Cancel from DELIVERY_FAILED: no restock, full refund | **confirmed current** | `common.py:383` `can_release_stock = previous_status != "DELIVERY_FAILED"`; runtime test ORD-CANCEL-FROM-FAILED (stock 49→49, refund PENDING) |
| 6 | Mobile Orders table 1033 px in 324 px; actions off-screen; many controls < 44 px; Delivery action column clipped at 1440 | **confirmed current** | measured in the demo run (`MOB-TABLE-SCROLL`, `A11Y-TOUCH-TARGETS`: 45 controls); CSS unchanged (`admin.css`/`globals.css` diff stats identical) |
| 7 | Orders capped at 200, no real pagination; client-side filters elsewhere; customers N+1 | **confirmed current** | `AdminOrdersPage.tsx:145 pageSize: 200`; `admin_payments.py`, `admin.py:list_admin_reviews`, `admin_orders.py:list_admin_refunds/list_admin_deliveries` ignore paging or `search`; `admin.py:317-334,356-368` per-customer queries |
| 8 | Login lockout also blocks the correct password; per-instance; logout doesn't revoke | **confirmed current** | `admin.py:72-90`; `security.py:issue_admin_token/verify_admin_token` (stateless); tests SEC-LOGIN-RATE-LIMIT / -LOCKOUT-AFFECTS-OWNER |
| 9 | Low-stock threshold setting saved but unused | **confirmed current** | `admin.py:515-516` writes `store_settings.low_stock_default_threshold`; alerts use `variant.low_stock_threshold` (`admin_catalog.py:205`); test SET-LOW-STOCK-NO-EFFECT |
| 10 | Header search doesn't refresh Orders when already on it | **confirmed current** | `AdminOrdersPage.tsx:101-108` reads `q` once into `useState`; test HDR-SEARCH-SAMEPAGE (BROKEN) |
| 11 | Raw ISO timestamps / inconsistent formats | **confirmed current** | backend `_iso()` returned as-is and rendered raw in Payments (`:302,:370`), Inventory (`:314`), Refunds (`:301,:352`), Reviews (`:269,:305`), order/delivery timelines |
| 12 | Orders page lacks "Delivery failed" action | **confirmed current** | `orderStateMachine.ts:63-72` `ORDER_ACTION_LABELS` has no DELIVERY_FAILED; Delivery page has it |
| 13 | Modals: Escape/focus handling incomplete | **confirmed current** | `'Escape'` handled only in `ConfirmDialog.tsx:31` and `DetailDrawer.tsx:23`; profile modal (`AdminHeader.tsx`) and `ImagePreview.tsx` have none; no `.focus()`/trap/return anywhere in `admin-panel/src` |
| 14 | KPI cards not clickable | **confirmed current** | `StatCard` `to` prop exists but no page passes it |
| 15 | "Net Profit" is only item margin; refund deduction effectively unreachable | **confirmed current** (second half INFERRED) | `admin.py:141-177` (excludes delivery charges; subtracts refunds only of DELIVERED orders, which cannot be cancelled per `domain.py:50-63`); tile subtitle already reads "Item revenue minus cost and completed refunds" but the title says "Net Profit" |
| 16 | Reports/Notifications mock; audit + notification rows unreadable | **confirmed current** | `App.tsx:36-37`; no `select(AdminAuditLog)`/`select(Notification)` in `backend/app`; 404 on `/admin/reports`, `/admin/notifications` |
| 17 | Typed-weight items skip stock | **confirmed current** | `admin_orders.py:295-297`, `orders.py` (`variant_id=None`), `common.py:_price_line` |
| 18 | Area hardcoded "Rajkot" | **confirmed current** | `orders.py:152,189` |
| 19 | Delivery metadata dates are free text; unreachable filter chips | **confirmed current** | `AdminDeliveryPage.tsx` text inputs; refunds chips PROCESSING/FAILED never produced (`admin_orders.py:786` only reads PROCESSING) |
| 20 | Storefront copy asks for a transaction ID | **confirmed current (new)** | `HomePage.tsx:102` |
| — | Items the review lists as strengths | verified as stated | state machine, reservations, historical prices, two-step refunds, review moderation |

Nothing was found `already fixed`. Items marked "needs verification": **none**; two still require a real environment I cannot use (Neon Auth role path, ordering gate outside local mode) — listed in section 6.

---

## 4. Work plan

Conventions: **Safe-now** = no business-policy change, can go first after approval. **Owner-gated** = do not start until the question in section 7 is answered. Tests use the existing harnesses: `admin-panel/tests/admin.test.mjs` (Node + React server-side rendering with stubs), backend `unittest` on SQLite (`backend/tests/`), plus browser smoke tests with Playwright against an **isolated** local stack (no new dependency in the repo unless approved — Q9).

### Phase A — quick UI/correctness fixes (Safe-now, except where marked)

| ID | Task | Files / area | Data / migration | Tests | Dependencies / risk | Rollback |
|---|---|---|---|---|---|---|
| T-A1 | **Header search syncs with the URL.** Derive the Orders search text from `?q=` (effect on `searchParams`) instead of one-time `useState`; keep manual typing working; Back/Forward re-applies. | `AdminOrdersPage.tsx` (+`AdminHeader.tsx` unchanged) | none | extend `admin.test.mjs` (render with `MemoryRouter` at `?q=A`, then `?q=B`, assert query value); browser smoke: 2 consecutive searches + Back | tiny | revert file |
| T-A2 | **Consistent timestamps.** One helper `formatDateTime(iso)` → `21 Oct 2026, 6:34 pm IST` (explicit zone label, `Asia/Kolkata`), used wherever raw ISO or ad-hoc `toLocale*` is rendered (Orders, Dashboard, Payments, Inventory, Refunds, Reviews, Delivery, timelines). Keep API data unchanged. | new `FE/lib/format.ts`; the 8 pages + `AdminTimeline` | none | unit tests for helper (ISO with/without `Z`/offset, invalid → "—"); update existing assertions that expect raw strings | owner must confirm display zone (Q7) | revert files |
| T-A3 | **Mobile Orders (and other wide tables).** At ≤ 768 px render each order as a card (order #, customer, product, total, badges) with the primary action buttons visible without horizontal scrolling; keep the table at larger widths. Fix the clipped Delivery action column (let the cell wrap/min-width, or stack the two buttons). Raise icon buttons (✕, ☰) and mobile action buttons to ≥ 44 px. | `AdminOrdersPage.tsx`, `AdminDeliveryPage.tsx`, `admin.css` (uncommitted file — see §5) | none | SSR test that mobile markup contains the actions; Playwright check at 390×844: no action requires horizontal scroll, min target 44×44 | CSS is already modified-uncommitted; coordinate (§5). Customers/Refunds/Payments cards are optional follow-up | revert CSS/markup |
| T-A4 | **Modal accessibility.** Escape closes profile modal and image preview; on open move focus into the dialog, trap Tab, return focus to the trigger on close, restore body scroll; keep existing Escape behaviour. One small shared hook used by `ConfirmDialog`, `DetailDrawer`, profile modal, `ImagePreview`. | `FE/components/*`, `AdminHeader.tsx` | none | SSR can't test focus → Playwright smoke: open/close each dialog, Tab cycles, focus returns; keep `admin.test.mjs` assertions green | focus traps are easy to get wrong; test keyboard-only | revert hook |
| T-A5 | **Stop misleading displays — consistent with D-02 (expiry stays disabled); wording only, PROPOSED.** (a) Inventory badge "Reservation Expiry Policy: N mins" and "Expires after Nm if unpaid" → neutral wording "Stock is held for unpaid orders until they are cancelled or confirmed (no automatic release yet)". (b) "Low-stock alert at (units)": see T-A6. | `AdminInventoryPage.tsx`, `AdminSettingsPage.tsx` text only | none | SSR text assertions | wording needs owner nod (Q3) | revert text |
| T-A6 | **Low-stock setting.** Option 1 *(recommended)*: treat the Settings value as the default for **new** variants and for variants the owner has not overridden (store `NULL` per-variant = "use default"), compute alerts with `COALESCE(variant.threshold, store default)`; migration `006` makes `product_variants.low_stock_threshold` nullable/backfills only variants still at the seed value 10 (**not** overriding any owner-edited value). Option 2: make the field read-only/remove it. | `admin_catalog.py:204-211`, `admin.py:515`, `models.py`, new `migrations/neon/006_*.sql`, `AdminSettingsPage.tsx` (touch carefully, §5) | migration (additive), backfill rule above | backend unit test: change setting → alert count changes; variant override wins; plus UI text test | owner chooses option (Q4) | forward-only: revert code; column stays nullable |
| T-A7 | **Delivery failed from Orders.** Add a "Record delivery failure" button on Orders rows for PICKED_UP / SHIPPED / OUT_FOR_DELIVERY that opens the existing dialog with the 5-character reason rule (server already supports it). | `orderStateMachine.ts` (`ORDER_ACTION_LABELS`), `AdminOrdersPage.tsx` | none | update state-machine tests; SSR test of the buttons | none | revert |
| T-A8 | **Post-action drawer behaviour.** Do not auto-open the order drawer after a row action (or make it an explicit choice). | `AdminOrdersPage.tsx:234-236` | none | SSR/browser | behavioural nicety → mention in Q-list (low) | revert |
| T-A9 | **Storefront copy.** Remove "and enter your transaction ID" from `HomePage.tsx:102`. (Different app: `frontend/`.) | `frontend/src/features/catalog/pages/HomePage.tsx` | none | storefront test suite, view check | **not admin; needs owner nod (Q8)** | revert |
| T-A10 | **Navigation — OWNER APPROVED (D-03).** Keep the five primary links; add a separate **Operations** group (Payments, Inventory, Delivery, Customers, Refunds) in the same sidebar component, reused by the mobile drawer. Group UI (always-visible small heading vs collapsible) still needs a UI nod. Pending-count badges remain Phase C. See `ADMIN_APPROVED_SCOPE.md` §5. | `AdminSidebar.tsx`, `admin.test.mjs:467-478`, `admin.css` | none | rewritten nav test (5 primary unchanged + Operations list), drawer render test, browser check of all five routes from desktop + mobile | coding GO + group-UI choice (Q-N1) | revert |

### Phase B — policy-dependent correctness (Owner-gated; do not start without answers)

| ID | Task | Gate | Outline | Files | Data / migration | Tests | Rollback |
|---|---|---|---|---|---|---|---|
| T-B1 | **Payment evidence hardening — D-01: Option 1 ONLY is owner-approved (warning, non-blocking). Options 2 and 3 are rejected.** | Q1 (policy decided; amount/duplicate-transfer rules open) | *Option 1 (no policy change):* hash each uploaded screenshot (SHA-256) at submit, store `payment_attempts.screenshot_sha256`, warn the admin in the drawer when the same hash exists on another order/attempt (the change plan's own suggestion). *Option 2:* optional customer-entered UTR + admin-entered "bank statement checked" attestation + reconciled amount (reuses unused `submitted_utr`/`verified_utr`; `bank_credits` stays unused or is retired by a later migration), duplicate-UTR block. *Option 3:* mandatory settlement check before VERIFIED (re-adds the safeguards the owner removed). No fictional bank check; no automatic approval. | `payments.py`, `admin_payments.py`, `AdminPaymentsPage.tsx`, models + migration | additive column(s) | backend tests: same file twice → warning/flag; duplicate UTR; attestation required; state machine unchanged (approval still → AWAITING_CONFIRMATION) | additive columns; feature flag off = old behaviour |
| T-B2 | **Reservation expiry — CLOSED by D-02 (disabled). Do not build; the outline is kept only as history.** | Q2 decided | *(historical)* After owner choice: idempotent job (Vercel cron → internal endpoint protected by a secret, or on-read reconciliation), `SELECT … FOR UPDATE`, `RELEASED` movement, audit row, never touches orders with a SUBMITTED/UNDER_REVIEW/VERIFIED payment, late proof re-reserves if stock exists else flags for admin (per the change plan's late-payment row). | `orders.py`, `payments.py`, new service module, `vercel.json`, Settings UI | possibly `orders.stock_released_at` | races: expiry vs proof upload, expiry vs confirm, double run, late proof, stock gone | disable cron; additive column |
| T-B3 | **Cancel after failed delivery — D-04: two separate admin choices (stock disposition + refund amount), case by case.** Principle approved; edge rules still BLOCKED (see `ADMIN_APPROVED_SCOPE.md` §8) | Q3 (partly decided) | Add an explicit disposition chosen at cancel time (RETURNED_SELLABLE / DAMAGED / LOST_NOT_RETURNED) — sellable returns stock with a `RETURNED` movement **only after physical-return confirmation**; others write an audited non-sellable movement; refund amount is entered by the admin (no full/zero default). Refund remains a **ledger of external transfers**. | `common.py:_cancel_order`, `admin_orders.py`, `AdminOrdersPage.tsx`/`AdminDeliveryPage.tsx` dialogs | possibly `inventory_movements.movement_type` values + `orders.cancellation_disposition` | extend `test_cancellation_service.py`, `test_delivery_state_service.py` | additive; old default preserved if flag unset |
| T-B4 | **Customer totals definitions** | Q5 | Compute from authoritative tables (`orders` + `refunds`) instead of incrementing at confirm: `orders_placed`, `orders_confirmed`, `orders_delivered`, `gross_confirmed`, `refunded`, `net`. Show the owner-chosen definitions in Customers; keep old columns until backfill is verified. | `admin.py:_serialize_admin_customer`, `Customer` model, customers page | backfill script (read-only comparison first) | backend tests for each definition incl. cancel and refund | keep old columns; switch via one function |
| T-B5 | **Dashboard honesty / metrics** | Q5 | Rename "Net Profit" to "Estimated item margin" (until costs/fees/overheads are modelled); add pending-orders, refunds-owed and low-stock tiles if wanted; make KPI cards link to filtered pages. Refund deduction logic reviewed against the unreachable-case finding. | `admin.py:get_admin_dashboard`, `AdminDashboardPage.tsx` | none | `test_dashboard.py`, SSR assertions | revert |
| T-B6 | **Typed-weight inventory** | Q9b | If bulk stock is real: weight ledger in grams per product, reservation at order, deduction at confirm, conversion rules; else keep current "weigh to order" and document it. | models, `common.py:_price_line`, `admin_orders.py`, Inventory UI | new table/columns | concurrent reservation tests | additive |
| T-B7 | **Login resilience** | Q10 | Shared (DB-backed) throttle keyed by IP + a per-email cap that never locks out a request carrying a valid signed session; owner recovery path (env change); optional shorter token life / server-side revocation list. Must not weaken authentication or log secrets. | `admin.py:72-93`, `security.py`, new small table | additive | extend `test_admin_login.py` | revert to current behaviour |

### Phase C — operating at scale (Safe-now once Phase A is merged, but larger)

| ID | Task | Outline | Tests |
|---|---|---|---|
| T-C1 | **Server-side pagination/filter/sort** for Orders, Payments, Deliveries, Reviews, Refunds, Customers (query `page`, `pageSize`, `total`; push `search`/status/date filters to SQL; real "Showing X–Y of N" and Previous/Next; debounce the search box 250–300 ms; remove the 200 cap). Fix the customer N+1 with aggregate queries/joins. | seed 250+ orders, 25+ customers; test each filter + page boundary; response-time smoke |
| T-C2 | **Read-only audit log + notification views** (secure endpoints `GET /api/admin/audit-logs`, `/notifications`; filters by module/date; owner-only; no PII beyond what the tables hold). Do **not** re-enable the mock Reports/Notifications pages; either delete the dormant pages + sample data after approval (Q11) or leave hidden. | backend access tests (401/403), pagination tests |
| T-C3 | **Sidebar badges / action queues** (pending payments, pending refunds, delivery failures) via one lightweight `GET /api/admin/summary`. Requires T-A10. | count correctness tests |
| T-C4 | **Reports** (only if wanted): real endpoint + CSV export built from SQL, no sample data. | optional |

---

## 5. Change-control and safety

1. **Git first.** 18 files are modified and uncommitted (not mine), including files the plan touches (`AdminSettingsPage.tsx`, `admin.css`, `globals.css`, `admin.test.mjs`, `storage.py`). Before implementing: create a branch from the current state **without** stashing/resetting, and ask who owns those edits (Q12). I will not run `git checkout`/`reset`/`clean`/`stash drop` on them and will edit only the hunks needed, re-reading each file immediately before editing because Settings changed under me once already.
2. **Order of implementation (after a GO naming task IDs):** T-A1 → T-A7 → T-A2 → T-A3 → T-A4 → T-A10 (approved) → (after nods) T-A5/T-A9/T-A6 → T-B1 (approved policy; rules in scope doc) → T-B3 (only after its blocking rules are answered) → other Phase B per answers → Phase C. T-B2 is not built. One logical commit per task.
3. **Environment:** isolated SQLite (`BFP_ENV=local`), throw-away admin credentials, stand-in storage; never `.env.local`'s Neon URLs, never Vercel/Neon MCP. Migrations: new numbered SQL file only (never edit applied 001–005); applying one to Neon production is a separate, explicitly approved step (and a Neon branch first).
4. **Checks per task:** `npm run typecheck`, `npm test` in `admin-panel/` (and `frontend/` for T-A9); `python -m unittest discover -s backend/tests` with a non-empty dummy `AWS_ENDPOINT_URL_S3` (the known env-dependency in `test_product_and_shop_images`); admin build; Playwright smoke at 1440×900 and 390×844 with before/after screenshots; `node scripts/verify-all.mjs` once at the end.
5. **Deliverables when implementing:** `ADMIN_CHANGELOG.md` (exact changes, migrations, screenshots, results, unresolved items, deployment notes).
6. **Documentation package:** move/ignore `BALAJI_ADMIN_DOCUMENTATION*` (Q13) so 151 PNGs are never committed to the app by accident.
7. **Security review** (`security-reviewer`) for T-B1, T-B2, T-B7, T-C2 before finishing; `code-reviewer` on the full diff.

---

## 6. Things I cannot verify from here (still open)
- Real Neon Auth customer tokens (403 path for customers) — only unit tests.
- The production ordering gate (settings confirmation + approved prices) — bypassed in local mode.
- Real object storage, Vercel body/timeouts, production data volumes.
- Whether the live storefront is built from the same working tree (the owner's note says live runs on a different Neon project — see memory/notes).

---

## 7. QUESTIONS REQUIRING OWNER DECISIONS

Recommended defaults are marked ★. Anything unanswered stays unimplemented.

> **Status after 2026-10-21:** Q1 → **decided (a)**, wrong-amount/duplicate-transfer part still open · Q2 → **decided: expiry stays disabled** (sub-questions on self-cancel/late proof are moot while expiry is off; self-cancel rules are unchanged) · Q3 → **decided in principle**, edge rules open (`ADMIN_APPROVED_SCOPE.md` §8) · Q6 → **decided**: 5 primary + Operations group. Q4, Q5, Q7–Q14 remain open proposals; the only ones that block the *first* coding batch are Q7 (timestamp zone/format), plus Q12 (uncommitted work) as a process gate. Text of the questions below is left as originally asked.

1. **Payment proof (T-B1).** You decided on 2026-10-19 that payment is approved from the screenshot alone (no UTR). The reviewer asks to re-open this before real money. Choose: ★ **(a) keep screenshot-only and add duplicate-screenshot warning (hash)**; (b) optional UTR + admin "checked on bank statement" attestation + duplicate-UTR block; (c) mandatory settlement check before VERIFIED (undoes your 2026-10-19 decision); (d) change nothing. Also: how do you want to handle customers who paid the wrong amount or twice?
2. **Reservation expiry (T-B2).** Withdrawn earlier. After how many minutes (current setting 30), and on expiry should the order (a) stay open but stock be released, or (b) be cancelled? ★(a) with re-reserve-on-late-proof if stock exists. Who may self-cancel at which stage? Are unpaid orders with an uploaded proof ever released?
3. **Failed delivery (T-B3).** When delivery fails and the order is cancelled: is the product (a) back and sellable, (b) damaged, (c) lost/not returned? Who bears the delivery fee, and is the refund full, minus fee, or case-by-case? ★ Ask per case at cancel time with an audited disposition; refund stays a manual external transfer. Also OK to reword the Inventory "Reservation Expiry" labels now (T-A5)?
4. **Low-stock alert (T-A6).** ★ Settings value = default for variants with no override (alerts use override else default), or remove the Settings field?
5. **Customer & dashboard figures (T-B4/T-B5).** Define "total spent": gross confirmed, delivered only, or net after refunds? Define "orders" similarly. Rename "Net Profit" to "Estimated item margin" until delivery cost/fees/overheads are modelled? ★ Yes, and keep both gross and net columns.
6. **Navigation (T-A10).** The five-link sidebar is currently locked by a test. ★ Add Payments, Inventory, Delivery, Customers, Refunds? Any you want to keep hidden?
7. **Time display (T-A2).** ★ "21 Oct 2026, 6:34 pm IST" everywhere (Asia/Kolkata)?
8. **Storefront copy (T-A9).** OK to remove "enter your transaction ID" from the home page step 2 (payment is screenshot-only today)?
9. **Typed-weight items and tooling.** (a) Do arbitrary-gram orders draw down bulk stock (kg ledger), and in what unit? (b) May I add Playwright as a dev-only dependency in `admin-panel` for permanent browser smoke tests, or should those stay outside the repo? ★ dev-only dependency.
10. **Admin login (T-B7).** Is a DB-backed throttle plus "the correct password is never blocked while a valid session exists" acceptable? Should logout truly revoke the token (needs a small table)? Preferred token lifetime (currently 12 h)?
11. **Dormant code.** Delete the unrouted Reports/Notifications pages and 1,070 lines of sample data, or keep them hidden until built? ★ Keep hidden, decide when T-C2/T-C4 are scoped.
12. **Uncommitted work.** Who owns the 18 uncommitted files (esp. `AdminSettingsPage.tsx`)? ★ Commit or branch them first, then I build on top.
13. **Documentation package.** ★ Move `BALAJI_ADMIN_DOCUMENTATION/` and the ZIP to `docs/admin-audit/` and add the PNGs to `.gitignore` (keep README + Markdown tracked), and package sanitized capture/seed scripts under `reproducibility/` (they refuse non-local databases).
14. **Customer area.** Replace hardcoded area "Rajkot" with a value derived from PIN/address, or keep until you provide a PIN→area list?

## 8. What can go first once you say "go"
Safe quick UI fixes, in this order: **T-A1** header search · **T-A7** delivery-failed on Orders · **T-A2** timestamps (needs Q7) · **T-A3** mobile Orders/Delivery layout · **T-A4** modal Escape/focus · **T-A10** Operations group (approved, D-03). After a yes on Q4/Q8 and the T-A5 wording: T-A5, T-A6, T-A9. **T-B1** has an approved policy but needs its rule set confirmed; **T-B3** is blocked on its edge rules; **T-B2** is closed. Nothing in Phase B starts before its question is answered. Full spec, tests and rollback: **`ADMIN_APPROVED_SCOPE.md`**.
