# Balaji Faki Point Admin — Approved Implementation Scope

**Date:** 2026-10-21 · **HEAD:** `0a69f7e` · **Status: PLAN ONLY — NOTHING IMPLEMENTED, NOTHING AUTHORIZED TO CODE.**
Source of the decisions: owner's "Final Owner Decisions" (D-01…D-05, 2026-10-21). Backlog and audit evidence: `ADMIN_IMPROVEMENT_PLAN.md`. Prior owner rules preserved: `docs/CLAUDE_CHANGE_PLAN.md`, `docs/CLAUDE_FINAL_REQUIREMENTS.md`.

Audience: the owner (approve / correct) and whoever implements after a GO.

> **Progress 2026-10-21:** owner GO given for **T-A1** and **T-A7** only. Both are implemented in the working tree (uncommitted) and verified — see `ADMIN_CHANGELOG.md`. Everything else below is still waiting.

## 0. How to read this document

| Label | Meaning |
|---|---|
| **OWNER APPROVED** | The owner stated the policy. Says nothing about coding. |
| **PROPOSED** | My recommendation. Not approved. Stays unbuilt unless the owner approves. |
| **BLOCKED** | Cannot be specified/coded until a listed decision is answered (§8). |
| **WAITING FOR IMPLEMENTATION GO** | Specified well enough to build; no coding until the owner replies "GO" naming task IDs. |

A task can carry two labels (e.g. policy OWNER APPROVED + WAITING FOR IMPLEMENTATION GO). Evidence labels: **VERIFIED** (seen in current source/diff, this session), **INFERRED**, **UNKNOWN**.
Precedence: D-01…D-05 > this document > `ADMIN_IMPROVEMENT_PLAN.md` > review suggestions. A recommended default is never an approval.

---

## 1. Task matrix

| ID | Task | Policy | Build state | Needs first |
|---|---|---|---|---|
| T-A1 | Header search follows `?q=` | PROPOSED (safe fix) | **IMPLEMENTED, uncommitted (GO 2026-10-21)** | review/commit decision |
| T-A7 | "Record delivery failure" on Orders | PROPOSED (safe fix) | **IMPLEMENTED, uncommitted (GO 2026-10-21)** | review/commit decision |
| T-A2 | One readable timestamp format | PROPOSED → format taken as approved by the GO | **IMPLEMENTED, uncommitted (GO 2026-10-21)** | review/commit decision; Settings page left unchanged |
| T-A3 | Mobile Orders + Delivery layout, 44 px targets | PROPOSED (safe fix) | **IMPLEMENTED, uncommitted (GO 2026-10-21)** | review/commit decision |
| T-A4 | Modal keyboard accessibility | PROPOSED (safe fix) | **IMPLEMENTED, uncommitted (GO 2026-10-21)** | review/commit decision |
| T-A10 | Operations navigation group | **OWNER APPROVED** (D-03) | **IMPLEMENTED, uncommitted (GO 2026-10-21; N-2 default: always-expanded group)** | review/commit decision |
| T-B1 | SHA-256 duplicate-screenshot warning | **OWNER APPROVED** (D-01) | WAITING FOR IMPLEMENTATION GO | Confirm 3 rule defaults (N-3) |
| T-B2 | Reservation expiry | **OWNER APPROVED: keep disabled** (D-02) | **CLOSED — nothing to build** | — |
| T-A5 | Fix misleading expiry wording | PROPOSED text only | WAITING FOR IMPLEMENTATION GO (separate nod) | Wording nod |
| T-B3 | Failed-delivery cancel: stock disposition + refund amount | **OWNER APPROVED in principle** (D-04) | **BLOCKED** | Decisions B3-1…B3-5 (§8) |
| T-A9 | Storefront home copy: drop "transaction ID" | PROPOSED | WAITING FOR IMPLEMENTATION GO (Q8) | Q8 nod |
| T-A6 | Low-stock threshold semantics | PROPOSED | **BLOCKED** (Q4) | Q4 |
| T-A8 | Don't auto-open drawer after row action | PROPOSED, optional | not requested | UX preference |
| T-B4…B7, T-C1…C4 | Customer totals, margin label, typed-weight, login, scaling, audit views, badges, reports | PROPOSED | **BLOCKED / not authorized** | individual approvals |

Nothing outside D-01…D-04 changes any business rule. All existing state machines, stock rules, refund-ledger rules and the five-link/`Settings` setup stay as they are.

---

## 2. OWNER APPROVED policy (verbatim intent)

- **D-01 Payment.** Keep screenshot-only manual verification (customer uploads, admin approves/rejects). Add SHA-256 duplicate-screenshot detection → **warning only**; never auto-reject, never "fraud" wording, no mandatory UTR/transaction ID/bank statement, no auto-approval, payment + order state machines untouched. *Undecided:* wrong amount paid, same real transfer used twice.
- **D-02 Expiry.** Disabled. No auto-cancel, no timer-based stock release, no cron/background job. Manual reservation + cancellation flow unchanged. Misleading text → *propose* fix only.
- **D-03 Navigation.** Five primary links unchanged (Dashboard, Price Management, Order Management, Feedback Management, Settings) + separate **Operations** group: Payments, Inventory, Delivery, Customers, Refunds. Compact, accessible, works on desktop and mobile. Nothing removed or replaced.
- **D-04 Failed delivery.** After `DELIVERY_FAILED`, cancelling requires two independent admin choices: **stock disposition** (returned-sellable / damaged / lost-not-returned) and **refund amount** (case by case). No assumed full refund. Damaged/lost never go back to sellable. Sellable return needs physical-return confirmation + audit. Refunds stay a manual, external bank-transfer record; the panel moves no money. Edge cases must be settled before coding.
- **D-05.** This round: documents only.

---

## 3. Git working tree (read-only inspection, 2026-10-21)

- HEAD `0a69f7e`, branch `main`, **no new commits**. `git status`: the **same 18 modified files** reported earlier + 3 untracked (`ADMIN_IMPROVEMENT_PLAN.md`, `BALAJI_ADMIN_DOCUMENTATION/`, `BALAJI_ADMIN_DOCUMENTATION.zip`) — VERIFIED. `git diff --stat`: 18 files, +368 / −209, **identical to the earlier report**. `AdminSettingsPage.tsx` still +34 (other contributor's edit).
- Nothing was staged, stashed, reset, cleaned or committed by this task. Only `ADMIN_IMPROVEMENT_PLAN.md` (edited) and `ADMIN_APPROVED_SCOPE.md` (new) were written; both untracked.

**Overlap: which planned tasks touch the 18 uncommitted files** (these need a hunk-level edit after re-reading the file, never a checkout/overwrite):

| Uncommitted file (diff) | Planned tasks that must edit it | Note |
|---|---|---|
| `admin-panel/.../AdminSidebar.tsx` (+1) | T-A10 | At HEAD the sidebar has **4** links; the 5th (`Settings`) *is* the uncommitted hunk. D-03's "existing five" therefore exists only in the working tree. |
| `admin-panel/tests/admin.test.mjs` (+70) | T-A10, T-A1, T-A2, T-A4, T-A7 | The exact-5 nav assertion (`:467-478`) is in an uncommitted hunk too. |
| `admin-panel/.../styles/admin.css` (−21) | T-A3, T-A4, T-A10 | Also touched by someone else. |
| `admin-panel/src/styles/globals.css` (−78) | possibly T-A3 | Only if shared utility CSS is needed; prefer `admin.css`. |
| `admin-panel/.../AdminSettingsPage.tsx` (+34, other contributor) | T-A5 (line ~207 already says "Orders are never cancelled automatically…"), T-A6 | **Do not touch** in the first batches. |
| `backend/app/core/storage.py` (+36), `backend/tests/test_neon_storage.py`, `test_catalog_products.py` | none directly; T-B1 tests may stub storage | Read the hunk before reusing helpers. |
| `docs/VERCEL_DEPLOYMENT.md`, `admin-panel/index.html`, `frontend/*` (9 files) | none (T-A9 edits `frontend/.../HomePage.tsx`, which is **not** modified today) | No overlap. |

**Not overlapping, clean at HEAD:** `AdminOrdersPage.tsx`, `AdminDeliveryPage.tsx`, `AdminInventoryPage.tsx`, `AdminPaymentsPage.tsx`, `AdminHeader.tsx`, `ConfirmDialog.tsx`, `DetailDrawer.tsx`, `ImagePreview.tsx`, `orderStateMachine.ts`, backend `routes/*`, `models.py`.

**Process gate (Q12):** before the first GO, snapshot the uncommitted state non-destructively (a branch alone does not save uncommitted work — use a commit on a new branch *with the owner's OK*, or a file copy of the 18 files + patch via `git diff > patch`), and ask who owns the 18 files. No `reset`, `clean`, `checkout --`, `stash drop`.

---

## 4. Phase A specifications

General for all Phase A: no backend change, no migration, no business-rule change. Checks per task: `npm run typecheck` + `npm test` in `admin-panel/`, admin build, Playwright smoke at 1440×900 and 390×844 against an isolated local stack (SQLite, throw-away admin, stand-in storage — the harness already exists outside the repo). Rollback for all: revert that task's commit (one logical commit per task); no data to undo.

### T-A1 — Header search follows the URL · PROPOSED · WAITING FOR IMPLEMENTATION GO
- **Defect (VERIFIED):** `AdminOrdersPage.tsx:101-108` seeds search state once from `?q=`; header search navigates to `/admin/orders?q=…` while already on the page, so the table doesn't change. Runtime test HDR-SEARCH-SAMEPAGE was BROKEN.
- **Files:** `admin-panel/src/features/admin/pages/AdminOrdersPage.tsx`; tests `admin-panel/tests/admin.test.mjs` (uncommitted file — append, don't rewrite).
- **Steps:** (1) make the URL the source of truth for the committed query (`searchParams.get('q')`), (2) keep the typed input local, writing back to `?q=` on submit/debounce with `replace` to avoid history spam, (3) when `?q=` changes (header, Back/Forward) reset page to 1 and refetch, (4) clearing the box removes `q`.
- **Acceptance:** at `/admin/orders?q=A` then header-search `B` → input shows B and rows are B's, without reload; Back returns to A with A's rows; Forward → B; empty search clears filter; typing in the Orders box still filters; no change to payment/status behaviour. SSR test with `MemoryRouter` at `?q=A` then re-render at `?q=B`; Playwright: two consecutive searches + Back/Forward.
- **Risk:** low (a loop between input and URL if both write; guard by comparing values).

### T-A7 — Delivery failure from Orders · PROPOSED · WAITING FOR IMPLEMENTATION GO
- **Defect (VERIFIED):** `orderStateMachine.ts` `ORDER_ACTION_LABELS` (`:63-72`) has no `DELIVERY_FAILED`; Delivery page has it. Server `PATCH /api/admin/orders/{id}/status` (`admin_orders.py:407-454`) already accepts `DELIVERY_FAILED` with `failure_reason` ≥ 5 chars; `AdminOrdersPage.tsx:209` already has the 5-char check and `:232` already sends `failureReason`.
- **Files:** `orderStateMachine.ts`, `AdminOrdersPage.tsx`, `admin.test.mjs`.
- **Steps:** add a label/button "Record delivery failure" (danger-outline) for `PICKED_UP`, `SHIPPED`, `OUT_FOR_DELIVERY` only (the transitions already allowed at `orderStateMachine.ts:40-42`), routed through the existing reason dialog; no other transitions touched.
- **Acceptance:** button present only in those three statuses; <5-char reason blocked client-side and server returns 422; success shows `DELIVERY_FAILED` + history note; button absent for DELIVERED/CANCELLED/DELIVERY_FAILED; state-machine tests updated for the label map only.
- **Interaction with T-B3:** this task only *records* the failure. Cancelling a failed delivery stays as today (full refund, no restock) until T-B3 is built — flag this to the owner as a known interim state.

### T-A1/T-A7 follow-up (F-1, F-2, F-3) · IMPLEMENTED, uncommitted (GO 2026-10-21) — see ADMIN_CHANGELOG.md
Source: independent review of the first batch. Business rules untouched (payment, expiry, cancellation/refund, inventory). Touches **3 files**: `AdminOrdersPage.tsx` and `admin.test.mjs` (both already modified by batch 1) + `AdminHeader.tsx` (clean at HEAD, one line). No CSS, no backend, no state-machine change.

**Behaviour (the rule that separates the cases):** react-router's `useNavigationType()` = `POP` for initial load/Back/Forward; the header passes `state: { headerSearch: true }`; anything else (active sidebar link, other links) carries no such flag.

| Navigation to `/admin/orders…` | Query box | Status/Payment/Dates | Request |
|---|---|---|---|
| Header submit (PUSH, `headerSearch`, non-empty `q`) | = new `q` | **reset to ALL / ALL / empty** | exactly 1 (also when the search text is identical to the last one) |
| Back / Forward (POP) | = that entry's `q` (empty if none) | unchanged (not in URL) | 1 only if query changed |
| Click on the active "Order Management" link (PUSH/REPLACE, no `q`) | unchanged | unchanged | **none** |
| Arrive from another page (page mounts) | from URL (`q`/`orderId`) or empty | defaults (`status=` param honoured as today) | 1 (initial) |
| Typing in the Orders box | typed text | **not reset** | as today |

**F-1/F-2 patch (`AdminOrdersPage.tsx`)** — replace the batch-1 effect (`:132-137`):
```tsx
const navType = useNavigationType();            // import from react-router-dom
const [refreshTick, setRefreshTick] = useState(0);   // add to the fetch effect deps
useEffect(() => {
  if (navType === 'POP') { setQuery(urlQuery); return; }   // load, Back, Forward: URL is the truth
  if (!urlQuery) return;                                    // e.g. active sidebar link: keep working state
  setQuery(urlQuery);
  if ((location.state as { headerSearch?: boolean } | null)?.headerSearch) {
    setStatusFilter('ALL'); setPaymentFilter('ALL'); setDateFrom(''); setDateTo('');
    setRefreshTick((t) => t + 1);                           // one batched render → one request, even for an identical search
  }
}, [location.key]);
```
`AdminHeader.tsx:54`: `navigate(url, { state: { headerSearch: true } })`. The fetch effect gets `refreshTick` added to its dependency list; the filter setters are batched with `setQuery`, so no duplicate request and no URL write-back (no loop).

**F-3 patch:** `tone={pendingAction?.nextStatus === 'CANCELLED' || pendingAction?.nextStatus === 'DELIVERY_FAILED' ? 'danger' : 'primary'}` (`AdminOrdersPage.tsx:~638`). `ConfirmDialog` already renders the red `#B42318` style for `danger`. Reason validation and the transition are untouched.

**Tests (replace the batch-1 shared-page block with independent mounts; extend `mountPage` route stub with `navType` and `state`):**
1. Header search with Status = Cancelled → box = q, status = ALL, request args `status: 'ALL'`.
2. Header search with Payment = VERIFIED + From/To dates → all four reset; request args carry no dates, `paymentStatus: 'ALL'`.
3. Active sidebar click (PUSH, no `q`, no state) → query, status, payment, dates unchanged; request count unchanged.
4. Fresh mount from another page without a query → empty box, all filters default; with `?q=` → box filled, filters default.
5. POP (Back, Forward) → box follows the entry; filters not reset; no extra request when query is unchanged.
6. `?q=` (empty) → empty search, full list; `?orderId=X` → X; `?q=A&orderId=B` → A (current behaviour, documented).
7. Repeated identical header search ×3 → exactly one request each, filters re-reset each time.
8. Typing in the box does not touch filters; no request storm (one per keystroke, as today).
9. T-A7: valid reason → `status: 'DELIVERY_FAILED'` + `failureReason`; 4-char reason → no request; server 409 rejection → error toast, dialog stays open; button also present in the drawer footer; absent for CONFIRMED/DELIVERED/CANCELLED/DELIVERY_FAILED; `ConfirmDialog.tone === 'danger'` for DELIVERY_FAILED, `'primary'` for Mark Shipped.
10. Browser smoke (isolated stack, desktop + mobile, script stays outside the repo) repeats 1–8 against the real router and counts `/api/admin/orders` requests with `page.on('request')`; plus a mutation check (revert F-1 → tests 1–2 fail; revert F-2 → test 3 fails).

**Risks / decisions (recommended defaults; say "defaults OK"):**
- Filters are not part of the URL, so Back/Forward restores the **query only** (not filters). ★ accept; putting filters in the URL is a bigger change.
- Identical repeated header search deliberately **refetches** (acts as a refresh). ★ yes.
- Any future component that links to Orders with `?q=` and wants the reset must pass `state.headerSearch`; the Customers-page order links do not and so do not reset (they open Orders fresh anyway).
- The unit tests use a stubbed router; real-router behaviour is covered only by the out-of-repo browser script (adding Playwright to the repo is still Q9b).
- Rollback: revert the 3 files; no data.

### T-A2 — Consistent timestamps · PROPOSED · WAITING FOR IMPLEMENTATION GO (N-1)
- **Defect (VERIFIED):** backend `_iso()` strings rendered raw in Payments (`:302`, `:370`), Inventory (`:314`), Refunds (`:301`, `:352`), Reviews (`:269`, `:305`), timelines; `toLocale*` used ad hoc in Customers/Dashboard/Orders/Settings.
- **Files:** new `admin-panel/src/features/admin/lib/formatDateTime.ts` (the plan's earlier `FE/lib/format.ts` does not exist; `features/admin/lib/` is the existing home); callers: the pages above + `AdminTimeline.tsx`; tests.
- **Proposed format (default, not approved):** `21 Oct 2026, 6:34 pm IST` via `Intl.DateTimeFormat('en-IN', {timeZone:'Asia/Kolkata'})`; date-only values (refund date) → `21 Oct 2026`; invalid/empty → `—`. API payloads unchanged. Delivery metadata date inputs are free text today → out of scope.
- **Acceptance:** unit tests: ISO with `Z`, with `+05:30`, with no zone (treated as UTC — INFERRED, backend stores aware UTC), invalid, null; SSR assertions that raw `T…Z` strings no longer appear on each listed page; screenshots show the label.
- **Risk:** existing assertions expecting raw strings must be updated (list them in the PR); only those, no others.

### T-A3 — Mobile Orders/Delivery layout · PROPOSED · WAITING FOR IMPLEMENTATION GO
- **Defect (VERIFIED, measured in demo run):** Orders table 1033 px in a 324 px viewport; row actions off-screen; 45 controls < 44 px; Delivery action column clipped at desktop.
- **Files:** `AdminOrdersPage.tsx`, `AdminDeliveryPage.tsx`, `admin.css` (**uncommitted** — hunk edit, §3), tests.
- **Steps:** (1) ≤ 768 px: render each order as a card (order #, customer, product, total, status badges, primary action buttons, "Details"); desktop table unchanged ≥ 769 px; (2) Delivery: let the action cell wrap / stack its two buttons; (3) raise ✕/☰/row-action buttons to ≥ 44×44 CSS px on touch widths.
- **Acceptance:** at 390×844, every Orders action reachable with no horizontal scroll; no horizontal page overflow; min target 44×44 for the changed controls (Playwright measurement); desktop screenshots 1440×900 unchanged except the Delivery action cell; SSR test that mobile markup contains the actions.
- **Risk:** medium (CSS shared with other pages). Scope the new rules to new class names.
- **Optional follow-up, not in scope:** cards for Customers/Refunds/Payments.

### T-A4 — Modal keyboard accessibility · PROPOSED · WAITING FOR IMPLEMENTATION GO
- **Defect (VERIFIED):** `Escape` is handled only in `ConfirmDialog.tsx:31` and `DetailDrawer.tsx:23`; profile modal (`AdminHeader.tsx`) and `ImagePreview.tsx` have none; no focus move/trap/return in `admin-panel/src`.
- **Files:** one small shared hook (e.g. `features/admin/hooks/useDialogFocus.ts`, new folder is acceptable), `ConfirmDialog.tsx`, `DetailDrawer.tsx`, `ImagePreview.tsx`, `AdminHeader.tsx`, tests. Keep `role="dialog"`/`aria-modal`/labels, add if missing.
- **Steps:** on open save `document.activeElement`, focus first focusable (or the dialog), trap Tab/Shift+Tab, Escape closes **unless** the action is busy (preserve current disabled/busy behaviour), on close restore focus to the trigger, keep body-scroll lock/restore.
- **Acceptance (Playwright, keyboard only):** for each of ConfirmDialog, DetailDrawer, profile modal, image preview: open → focus inside; Tab ×N never leaves; Escape closes; focus returns to the trigger. Existing `admin.test.mjs` assertions stay green.
- **Risk:** medium (nested dialogs, e.g. a confirm opened from a drawer: only the topmost handles Escape; use a stack or `stopPropagation`).

### T-A10 — Operations navigation group · **OWNER APPROVED (D-03)** · WAITING FOR IMPLEMENTATION GO (N-2)
- **Current (VERIFIED):** `AdminSidebar.tsx:16-27` — one group, 5 items in the working tree (4 at HEAD). Routes already exist and are protected: `/admin/payments`, `/admin/inventory`, `/admin/delivery`, `/admin/customers`, `/admin/refunds`. Mobile drawer reuses the same list.
- **Files:** `AdminSidebar.tsx` (uncommitted), `admin.css` (uncommitted), `admin.test.mjs:467-478` (uncommitted), possibly `AdminRouteGuard`/layout only if the drawer needs it.
- **Design (PROPOSED default):** keep `ADMIN_NAV_GROUPS[0]` untouched (five primary). Add a second group `Operations` rendered under a small heading with a `<nav aria-label>`/`<section aria-labelledby>` and the same link styling, five entries in the order Payments, Inventory, Delivery, Customers, Refunds; always expanded (no collapse state → nothing to persist, nothing to break); same markup in desktop sidebar and mobile drawer; active route highlighted; drawer closes after navigation as it does today. A collapsible variant is possible but adds state + aria-expanded handling — only if the owner wants it.
- **Acceptance:** nav test changed from "exactly 5 entries" to "primary group deep-equals the same 5 labels/paths **and** an Operations group deep-equals the 5 named entries"; both appear in desktop and drawer render; clicking each of the 10 links lands on its page (Playwright, 1440 and 390); keyboard Tab order primary → Operations; no link to the unrouted Reports/Notifications; auth guard unchanged (signed-out redirect still works); no badge/count claims.
- **Risk:** low. **Rollback:** revert the group; the five primary links are unaffected by construction.

### T-A5 — Expiry wording · PROPOSED (text only) · WAITING FOR IMPLEMENTATION GO (own nod)
- **VERIFIED misleading text:** `AdminInventoryPage.tsx:155` "Reservation Expiry Policy: N mins" and `:183` "Expires after Nm if unpaid"; stock-movement reason strings in `referenceData.ts` (demo data only). `AdminSettingsPage.tsx:207` already states orders are never cancelled automatically (uncommitted edit by another contributor — leave).
- **Proposed text:** badge → "Unpaid orders keep their stock held until cancelled or confirmed — no automatic release"; row → "Held until paid or cancelled". No logic, API or persistence change (`stock_reservation_expires_at` stays written as today; do **not** remove it).
- **Acceptance:** SSR text assertions; nothing on any admin page claims automatic expiry.

### T-A9 — Storefront copy · PROPOSED · WAITING FOR IMPLEMENTATION GO (Q8)
- `frontend/src/features/catalog/pages/HomePage.tsx:102` → "Scan, pay the exact amount and upload your payment screenshot." (matches D-01). Only occurrence found in `frontend/`. Test: `frontend/` suite + view check. Not an admin change.

### T-A6 — Low-stock threshold · PROPOSED · **BLOCKED (Q4)**; T-A8 · optional, not requested.

---

## 5. T-B1 — Duplicate-screenshot warning · **OWNER APPROVED (D-01)** · WAITING FOR IMPLEMENTATION GO (N-3)

**Current (VERIFIED):** `routes/payments.py:78` reads `raw_bytes`; `:80` validates the image; `:89-98` creates `PaymentAttempt` with `screenshot_storage_path="pending"`; `:101-114` stores the private proof; `models.py:342-376` has `submitted_utr`/`verified_utr` (unused), no hash column. Admin payment detail serializer is in `routes/admin_payments.py` (around `:116`, `:213`).

**Design**
1. **Data:** nullable `payment_attempts.screenshot_sha256` (64 hex chars), **non-unique** index. Old rows stay `NULL` = "not checked", never "unique".
2. **Write:** in `payments.py`, compute `hashlib.sha256(raw_bytes).hexdigest()` after validation, set on the new attempt before commit. No change to validation, storage, state transitions, idempotency or the 409 duplicate-submission guards.
3. **Read:** in the admin payment detail response add `duplicateScreenshot: { matches: [{ paymentId, orderNumber, orderStatus, paymentStatus, submittedAt, sameOrder }] }` (empty list when none or when this attempt's hash is `NULL`), computed with an indexed `WHERE screenshot_sha256 = :h AND id <> :id`, capped (e.g. 10). Only OWNER_ADMIN endpoints expose it (existing dependency); no customer name/phone/address in the match rows — order number + statuses + date only.
4. **UI (`AdminPaymentsPage.tsx` drawer + list badge):** amber "Possible duplicate screenshot — this exact file was also uploaded for #BFP-xxxx (Rejected, 12 Oct)." with links to those orders/payments. Wording is neutral: no "fraud", "fake", "reused by customer". Approve / Reject buttons stay exactly as today, enabled, with no extra confirmation required.
5. **Not done:** no auto-reject/approve, no upload blocking, no similarity/perceptual hash, no backfill of old files (needs reading private storage; separate optional script if the owner wants it).

**Migration proposal (not applied; number = next free `006_` at implementation time, since T-A6 may also want one):**
```sql
-- 00X_payment_screenshot_hash.sql  (additive, nullable, safe to re-run with IF NOT EXISTS)
alter table payment_attempts add column if not exists screenshot_sha256 text;
create index if not exists payment_attempts_screenshot_sha256_idx on payment_attempts (screenshot_sha256);
```
SQLite/test DBs get the column from `Base.metadata.create_all` (VERIFIED: `db/session.py:109`, tests use it). Applying to Neon is a **separate explicit approval** and should be done on a Neon branch first (`backend/migrations/neon/README.md`).

**Rollback:** code revert is enough (column unused → harmless); optional `drop index`/`drop column` is separate and destructive of the hashes only. Deploy order: migration first, then code.

**Acceptance tests (backend `unittest`, SQLite, stub storage as `test_payment_evidence.py` does):**
- same bytes uploaded for two different orders → second payment detail lists the first as a match with `sameOrder=false`; first payment detail lists the second;
- different bytes → empty `matches`;
- same order re-upload after a rejection → match with `sameOrder=true` (wording differs);
- attempt with `NULL` hash (legacy) → empty, no error; legacy attempts are never reported as matches;
- approving/rejecting a payment with a match works exactly as without one (status, history, audit unchanged); approval still ends at `AWAITING_CONFIRMATION`;
- customer endpoints never contain `screenshot_sha256` or `duplicateScreenshot`; non-admin → 401/403 on the admin endpoint;
- concurrent uploads of the same bytes both succeed (no uniqueness constraint);
- idempotent retry (same `Idempotency-Key`) does not change the hash.
Frontend SSR: banner renders for a match, absent otherwise, buttons unchanged. Security review (`security-reviewer`) required.

**Risks:** exact-byte hash only — re-saved/cropped/recompressed/screenshotted-again images evade it (state this in the UI help text); a customer legitimately re-sending the same file after a rejection will trigger a warning (hence `sameOrder` labelling). Does **not** address wrong-amount or duplicate real transfers (undecided).

---

## 6. T-B2 — Reservation expiry · **OWNER APPROVED: DISABLED** · CLOSED

Do not build: no scheduler, cron, endpoint, status change or time-based stock release; no new migration; `vercel.json` untouched. `stock_reservation_expires_at` and the `reservationExpiryMinutes` setting remain as stored data (not permission to act). Only the wording task T-A5 remains, and only if separately approved. Self-cancel rules (customer may cancel up to PACKED, `orders.py:348-359`) are unchanged. Re-opening requires a new decision (the four old open questions in `docs/CLAUDE_CHANGE_PLAN.md` item 6).

---

## 7. T-B3 — Cancel after failed delivery · OWNER APPROVED in principle (D-04) · **BLOCKED**

**Current (VERIFIED):** `routes/common.py:357-…` `_cancel_order`: `can_release_stock = previous_status != "DELIVERY_FAILED"` (`:383`) → no stock change after a failed delivery (stock stays deducted, `order.stock_deducted` set False at `:413` in the release branch only); refund auto-created for a VERIFIED payment as `PENDING` for **`order.total_paise`** (`:420-431`, full amount). Admin entry point: `PATCH /api/admin/orders/{id}/status` with `CANCELLED` (`admin_orders.py:434-443`). Customers cannot cancel in this state (`orders.py:348-355`). Refund flow: `PENDING → APPROVED → COMPLETED`, `record-transfer` requires verified amount **equal** to `refund_amount_paise` and bank-statement attestation (`admin_orders.py:789-815`) — so an admin-chosen amount fits the existing ledger without changing it. `inventory_movements.movement_type` has a **DB CHECK** in Postgres (`001_schema.sql:282-284`) limited to `MANUAL_ADD, MANUAL_DEDUCT, RESERVED, RELEASED, ORDER_DEDUCTED`; `Refund.original_payment_id` is NOT NULL and `refund_amount_paise` is a required BigInteger.

**Proposed design (all PROPOSED until §8 answered):**
- Cancel dialog, shown only when the order is `DELIVERY_FAILED`, with: (1) stock disposition radio — `RETURNED_SELLABLE`, `DAMAGED`, `LOST_NOT_RETURNED` (no default selected); (2) refund amount ₹ input (no default; shows total paid, delivery component, and any refund already recorded); (3) mandatory note ≥ 5 chars; (4) for `RETURNED_SELLABLE` a required checkbox "Goods physically received and inspected as sellable" + optional note/date; (5) summary confirmation before submit. Server enforces all of it; the client is cosmetic.
- Server: extend the status/cancel payload with `stockDisposition` and `refundAmount`; validate `0 ≤ amount ≤ captured paid total`; create the refund with the entered amount; write audit (`ORDER_CANCELLED` state JSON gains `disposition`, `refundAmountPaise`), status-history note. Other cancel paths (customer, earlier stages) unchanged. If the payload fields are absent on a `DELIVERY_FAILED` cancel the request is **rejected** (no silent default).
- Stock: `RETURNED_SELLABLE` → add quantity back to `total_stock` per line (as the existing release does for deducted stock) with a movement; `DAMAGED` / `LOST_NOT_RETURNED` → no change to sellable stock, a zero-delta audit movement so the Inventory history shows it. Typed-weight lines (no variant) → no stock effect (unchanged).
- **Migration proposal (additive):** (a) widen the CHECK on `inventory_movements.movement_type` to add e.g. `RETURNED_SELLABLE`, `WRITTEN_OFF_DAMAGED`, `WRITTEN_OFF_LOST` (all < 32 chars; label map in `admin_catalog.py:195-201` gets entries); (b) `orders.failed_delivery_disposition text null` (+ `disposition_note`, `disposition_recorded_at`, `disposition_recorded_by`) — or keep this solely in the audit/movement rows (smaller; choose at spec time); (c) none for refunds if zero-amount creates no row (see B3-2). SQLite tests need no migration.
- **Rollback:** code revert restores the old behaviour for new cancels; rows already written with the new movement types/columns stay (must be tolerated by the old label map: `_MOVEMENT_TYPE_LABELS.get(type, type)` already falls back). Dropping the widened CHECK back is only safe once no row uses the new values — do not drop.

**Acceptance tests (when unblocked):** each disposition × refund amount {0, partial, full}; amount > paid → 422; amount < 0 → 422; missing disposition/amount → 422; `RETURNED_SELLABLE` without confirmation flag → 422; sellable restock exactly once even if the request is retried; damaged/lost → `available_stock` unchanged; refund row amount equals the entered value and `record-transfer` still requires an equal verified amount; refund remains `PENDING` (no money state change); unrelated cancels (PENDING_PAYMENT, CONFIRMED, PACKED, customer cancel) behave exactly as before — existing `test_cancellation_service.py`/`test_delivery_state_service.py` stay green; existing orders already cancelled-from-failed are not modified.

---

## 8. Remaining decisions that genuinely block implementation

**Block T-B3 (answer all, or T-B3 stays unbuilt):**
- **B3-1 Physical return timing.** May `RETURNED_SELLABLE` be recorded in the same step as the cancellation (admin ticks "received and inspected"), or must it be a later step because goods are still in transit? ★ I recommend: allow it at cancel time only with the received/inspected tick; if goods aren't back yet, the order stays `DELIVERY_FAILED` until they are (no "pending return" state).
- **B3-2 Refund bounds and zero.** Maximum = amount actually paid (items + delivery charge)? Is ₹0 allowed, and does it create a refund row? ★ max = paid total; ₹0 allowed, creates **no** refund row, only an audit entry "no refund — reason"; any amount below the total requires the note.
- **B3-3 Granularity.** One disposition for the whole order, or per line item / quantity? ★ whole order for the first version; orders with mixed outcomes handled by the note until demand appears.
- **B3-4 Delivery charge.** Is the delivery charge refundable at the admin's discretion with nothing automatic (just visible as a component)? ★ yes, informational only.
- **B3-5 Customer message.** What, if anything, does the customer see about disposition/amount? ★ unchanged existing cancellation notification; amount shown only through the existing refund tracking.

**Block only the named task, with a default I will use if you simply say "defaults OK":**
- **N-1 (T-A2)** Timezone/format: `Asia/Kolkata`, `21 Oct 2026, 6:34 pm IST`.
- **N-2 (T-A10)** Operations group UI: always-expanded section with a heading (not collapsible), same in the mobile drawer.
- **N-3 (T-B1)** Rules: (i) also warn on a same-order re-upload, labelled differently; (ii) no backfill of old screenshots; (iii) up to 10 matches shown.
- **N-4 (T-A5, T-A9, T-A6)** Wording nods for T-A5/T-A9 and Q4 for T-A6, only when you want those tasks.

**Process gate for any GO:** Q12 — who owns the 18 uncommitted files, and OK to snapshot them on a branch before work starts.

Not blocking and still undecided (stay unbuilt): wrong-amount / duplicate-real-transfer handling (D-01 note), Q5, Q9–Q11, Q13, Q14.

---

## 9. Proposed implementation order (after a GO naming task IDs)

| Batch | Tasks | Why this order |
|---|---|---|
| 0 | Snapshot of the 18 files; re-run read-only `git status`/`git diff --stat` and compare against §3 | prevents overwriting others' work |
| 1 (Phase A, correctness) | **T-A1 → T-A7** | tiny, isolated to `AdminOrdersPage.tsx`/state machine; no CSS conflict |
| 2 | **T-A2** (after N-1) | touches many pages but only render text |
| 3 | **T-A3 → T-A4** | CSS/markup + shared hook; work on the uncommitted `admin.css` last and carefully |
| 4 | **T-A10** (approved) | edits the uncommitted sidebar + test; do after the file set has settled |
| 5 | **T-A5, T-A9** (if nodded) | text only |
| 6 | **T-B1** | migration + backend + one drawer; security review; needs N-3 |
| 7 | **T-B3** | only once B3-1…B3-5 are answered; highest-risk (stock + money ledger) |
| — | T-B2 | not built |
| later | T-A6, T-B4…B7, T-C1…C4 | separate approvals |

Per batch: one logical commit per task on a feature branch (commits only with the owner's OK; **no push** without a separate yes), `ADMIN_CHANGELOG.md` entries, before/after screenshots at 1440×900 and 390×844, results reported PASS/FAIL/NOT TESTED separately for admin `typecheck`, admin `test`, admin build, backend `unittest` (with a non-empty dummy `AWS_ENDPOINT_URL_S3`, the known env dependency), storefront tests when T-A9 is in, Playwright smoke. `code-reviewer` on each batch; `security-reviewer` on T-B1 and T-B3.

## 10. Environment, migrations and rollback rules (all batches)

- Tests run only on isolated SQLite (`BFP_ENV=local`), throw-away admin credentials, stand-in storage. Never Neon, Vercel, real bank or `.env` secrets; keys referred to by name only.
- Migrations: new numbered files in `backend/migrations/neon/` only (never edit 001–005); each additive and idempotent. Applying any migration to Neon production is a separate approval, on a Neon branch first, before the code that needs it.
- Phase A has no data changes → rollback = revert commit. T-B1/T-B3 are forward-only on the DB: the code can be reverted at any time; added nullable columns/CHECK values remain harmlessly.
- Tests that encode current deliberate behaviour stay unchanged unless the owner authorizes the specific assertion (only the nav-structure assertion changes, per D-03).

## 11. Confirmation for this planning round

Files written: `ADMIN_IMPROVEMENT_PLAN.md` (updated), `ADMIN_APPROVED_SCOPE.md` (new). No application source, tests, environment files, database, migrations, deployments, commits, pushes or stashes were touched; only read-only `git` and file reads were run. **Waiting for your explicit implementation GO naming task IDs.**
