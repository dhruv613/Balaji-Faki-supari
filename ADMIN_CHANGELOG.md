# Admin Panel Changelog

## 2026-10-21 — Batch 1: T-A1, T-A7 (owner GO: "GO T-A1 T-A7")

**Status: implemented in the working tree, NOT committed, NOT pushed, NOT deployed.** No backend, database, migration or environment change.

### Code changes (3 files)
| File | Change |
|---|---|
| `admin-panel/src/features/admin/pages/AdminOrdersPage.tsx` | **T-A1.** Imports `useLocation`; the search text is re-applied from `?q=` (or `?orderId=`) on every navigation via an effect keyed on `[location.key, urlQuery]`. Header search while already on Orders, Back/Forward, and re-searching the same text now update the box and refetch. Typing in the box still works (it does not navigate, so it is never overwritten). |
| `admin-panel/src/features/admin/lib/orderStateMachine.ts` | **T-A7.** `ORDER_ACTION_LABELS.DELIVERY_FAILED = 'Record Delivery Failure'`; `getAllowedOrderActions` gives it the `danger` tone. Button appears only where the existing transition table allows it (PICKED_UP, SHIPPED, OUT_FOR_DELIVERY). The existing reason dialog (≥ 5 chars) and `failureReason` payload were already in `AdminOrdersPage.tsx`; the server route already accepted it. |
| `admin-panel/tests/admin.test.mjs` | `mountPage` takes an optional route stub (`useSearchParams`/`useLocation`); new blocks for T-A1 (successive searches, Back, Forward, typing, same-text re-search) and T-A7 (button visibility per status, short reason blocked, valid reason sends `status: DELIVERY_FAILED` + `failureReason`). |

Not changed on purpose: the Delivery page, `AdminHeader.tsx`, CSS, any file of the other contributor's uncommitted work other than appending to `admin.test.mjs`.

### Verification (all on isolated local stack: SQLite, throw-away admin, stand-in storage; no Neon/Vercel/bank)
| Check | Result |
|---|---|
| `npm test` (admin-panel) | PASS |
| `npm run typecheck` | PASS (no output) |
| `npm run build` | PASS |
| Mutation check: T-A1 effect disabled → new test fails ("a second header search updates the box on the same route"); restored → passes | PASS |
| Playwright smoke, desktop 1440×900: 6 × T-A1 + 2 × T-A7 | 8/8 PASS |
| Playwright smoke, mobile 390×844: same 8 | 8/8 PASS |
| Backend `unittest` | NOT TESTED (no backend change) |
| Storefront tests | NOT TESTED (no storefront change) |
| `node scripts/verify-all.mjs` | NOT RUN (end-of-project check) |
| Before screenshots | NOT CAPTURED (behavioural fixes; after-state shots are in the scratch folder only, not in the repo) |
| `code-reviewer` / `security-reviewer` agents | NOT RUN (3-file UI change, no auth/data surface) |

### Notes
- T-A7 only *records* the failure. Cancelling a `DELIVERY_FAILED` order is unchanged (no restock, full refund) until T-B3 is unblocked.
- `status=` in the URL is still read once at mount (out of scope for T-A1).
- Rollback: revert these 3 files; no data to undo. A pre-change patch of the 18 uncommitted files was saved outside the repo (scratch folder `snapshot/uncommitted-before-TA1-TA7.patch`).
- Deployment: front-end only; nothing to migrate.

## 2026-10-21 — Batch 1 follow-up: F-1, F-2, F-3 (owner GO: "GO F-1 F-2 F-3")

**Status: implemented in the working tree, NOT committed, NOT pushed, NOT deployed.** Frontend only; no backend, migration, payment, expiry, cancellation/refund or inventory change.

### Code changes (3 files)
| File | Change |
|---|---|
| `admin-panel/src/features/admin/components/AdminHeader.tsx` | **F-1.** The header search navigates with `state: { headerSearch: true }`. |
| `admin-panel/src/features/admin/pages/AdminOrdersPage.tsx` | **F-1/F-2.** Navigation effect rewritten (`useNavigationType`, `appliedKey`, `refreshTick`): first render does nothing; load/Back/Forward (POP) apply the URL's query and leave filters alone; a flagged header search applies the query, resets Status/Payment/From/To to ALL/ALL/empty and forces exactly one refresh (also for an identical repeated search); any other navigation without a query (e.g. the active sidebar link) keeps the working state and sends no request. **F-3.** Delivery-failure confirmation uses `tone="danger"`. |
| `admin-panel/tests/admin.test.mjs` | `mountPage` route stub gained `state` and `navType`. The batch-1 shared-page block was replaced by independent mounts: header search + Cancelled filter, + payment/date filters, active sidebar click (PUSH and REPLACE), plain `?q=` link, arriving from another page / Customers link / header, Back/Forward (history entries carrying the header flag), empty `?q=` / `?orderId=` / precedence, repeated identical searches, typing, and T-A7 (valid/short reason, server rejection keeps dialog open, drawer-footer button, danger vs primary tone). |

### Verification (isolated stack: SQLite, throw-away admin, stand-in storage; no Neon/Vercel/bank)
| Check | Result |
|---|---|
| `npm test`, `npm run typecheck`, `npm run build` | PASS |
| `git diff --check` | clean |
| Mutation checks (6): drop filter reset; drop empty-query guard; drop first-render guard; drop refresh tick; let POP reset filters; confirm tone back to primary | each makes a named test fail; restored file passes |
| Real-router Playwright regression (new script, scratch folder), desktop 1440×900 + mobile 390×844, 10 scenarios each | 20/20 PASS |
| Batch-1 Playwright smoke (re-run) | 16/16 PASS |
| Backend `unittest`, storefront tests, `scripts/verify-all.mjs` | NOT RUN (no change there / end-of-project) |
| `code-reviewer`, `security-reviewer` | NOT RUN |

### Notes
- In `vite dev` React StrictMode doubles mount effects, so any fresh mount of Orders (before and after this change) sends 2 identical GETs; production builds send 1. The browser test therefore compares "header search from another page" to a plain mount.
- Back/Forward restore the search text only; filters are not in the URL.
- A link to Orders that wants the filter reset must pass `state.headerSearch` (Customers-page order links do not, and open Orders fresh).
- Rollback: revert the 3 files. Pre-change patch of the working tree: scratch folder `snapshot/before-F1F2F3.patch`. All other 18 dirty files verified byte-identical to that patch.

## 2026-10-21 — Batch 2: T-A2 consistent timestamps (owner GO; format `21 Oct 2026, 6:34 pm IST` taken as approved)

**Status: implemented in the working tree, NOT committed, NOT pushed, NOT deployed.** Display only: API values, filters (`Date.parse(createdAt)` etc.), backend and DB are unchanged.

### Code changes
| File | Change |
|---|---|
| `admin-panel/src/features/admin/lib/formatDateTime.ts` (**new**) | `formatDateTime` → `21 Oct 2026, 6:34 pm IST`; `formatDate` → `21 Oct 2026`. Fixed zone `Asia/Kolkata` (label `IST`) via `Intl`, independent of the browser's zone. Zone-less timestamps read as UTC; bare dates (`2026-10-19`) are shown as that calendar date without shifting; null/empty/unparsable → `—`. No zero-padding of day/hour. |
| `components/AdminTimeline.tsx` | one change covers every timeline (Orders, Delivery, Payments audit history). |
| `pages/AdminOrdersPage.tsx` | table "Order Date" and drawer "Placed on …". |
| `pages/AdminDashboardPage.tsx`, `AdminCustomersPage.tsx` (last order / joined → date only), `AdminInventoryPage.tsx`, `AdminPaymentsPage.tsx` (list, drawer, "approved on"), `AdminRefundsPage.tsx` (cancelled at, refund date), `AdminReviewsPage.tsx` | raw ISO / ad-hoc `toLocale*` replaced by the helper. |
| `tests/admin.test.mjs` | loader stubs for the new module; T-A2 block: 12 formatting cases (offsets, microseconds, zone-less, IST midnight/noon, year rollover, bare date, invalid), timeline, Orders table + drawer, Inventory movement, and a source guard (no raw time fields / `new Date(…).toLocale…` in the 8 pages). |

Deliberately NOT changed: `AdminSettingsPage.tsx` ("confirmed on …" still uses `toLocaleString`; another contributor's uncommitted file — your call), the unrouted `AdminNotificationsPage.tsx`, and the free-text delivery date inputs. CSS untouched (the Orders date now wraps over two lines inside its column).

### Verification (isolated stack; no Neon/Vercel/bank)
| Check | Result |
|---|---|
| `npm test`, `npm run typecheck`, `npm run build`, `git diff --check` | PASS |
| Mutation checks (5): timeline raw, inventory raw, orders drawer raw, helper zone → UTC, refunds raw date | each fails a named test; restored passes |
| Playwright scan, desktop 1440×900 + mobile 390×844, 8 pages (+ 6 detail drawers each): no raw ISO text, IST convention present in Orders/Payments/Refunds drawers, no page-level horizontal overflow | 30/30 PASS |
| Helper under other process time zones | NOT TESTED (the helper pins the zone; not verified by running with a different `TZ`) |
| Backend / storefront tests, `verify-all.mjs`, `code-reviewer` | NOT RUN |

### Notes
- Pre-change patch: scratch folder `snapshot/before-TA2.patch`; the other tracked dirty files (incl. `AdminSettingsPage.tsx`) are unchanged by this batch.
- Rollback: revert the 8 modified files and delete `formatDateTime.ts`; no data.

## 2026-10-21 — Batch 3: T-A3 mobile Orders/Delivery layout + T-A4 modal keyboard use (owner GO)

**Status: implemented in the working tree, NOT committed, NOT pushed, NOT deployed.** Frontend only; no backend, migration or business-rule change.

### T-A3 — code changes
| File | Change |
|---|---|
| `pages/AdminOrdersPage.tsx`, `pages/AdminDeliveryPage.tsx` | `<table className="data-table data-table--cards">`; each `<td>` gets `data-label` (and `cell-wide` / `data-table__actions`). Markup/handlers otherwise unchanged. Delivery's wrapper uses `admin-table-wrap` instead of `customer-table-scroll`, whose column min-widths made the table 1175 px wide and clipped the action column at 1440 px. |
| `styles/admin.css` (uncommitted file; **new hunk before `@media print`**, the other contributor's deletion at the end of the file is untouched) | ≤ 768 px: one card per row (2-column grid, label above value, actions as the card footer, `thead` visually hidden but kept). ≤ 1024 px or coarse pointer: ☰ button 44×44; `.btn--sm`, profile pill, search input, sidebar links ≥ 44 px high; `.text-button` ≥ 44×44. Desktop mouse layout unchanged. |

### T-A4 — code changes
| File | Change |
|---|---|
| `lib/useModalDialog.ts` (**new**) | One hook for all dialogs: focus moves in on open (`[data-autofocus]` first, else the first control), Tab/Shift+Tab wrap inside, Escape closes (not while busy), **only the topmost open dialog reacts**, focus returns to the opener on close. Pure helpers `nextTabTarget` and `isTopmostDialog` are unit-tested. |
| `components/ConfirmDialog.tsx`, `DetailDrawer.tsx`, `ImagePreview.tsx`, `AdminHeader.tsx` (profile modal) | Use the hook (private `window` Escape listeners removed); `tabIndex={-1}` on the dialog root; `useId()` titles so a drawer and a confirmation opened together no longer share one `aria-labelledby` id; profile name field has `data-autofocus`. |
| `tests/admin.test.mjs` | `modalMod` loader stub; tests for the Tab-wrap and topmost logic, unique labelled dialogs, hook usage and busy-Escape wiring, card-table labels (one labelled `td` per `th`, Action cell), Delivery wrapper class. |

### Verification (isolated stack, fresh DB per suite; no Neon/Vercel/bank)
| Check | Result |
|---|---|
| `npm test`, `npm run typecheck`, `npm run build`, `git diff --check` | PASS |
| Keyboard-only Playwright, desktop + mobile (7 scenarios each: confirm dialog, drawer, nested confirm-in-drawer, image preview over drawer, profile modal, 44 px close button, Escape ignored while busy) | 14/14 PASS |
| Mutation checks: Tab wrap swapped (unit); every dialog "topmost" (nested + preview tests fail); no focus restore (6+ browser tests fail) | detected; restored passes |
| Layout measurements before → after: Mobile Orders table 1042 px in a 324 px viewport, 42 actions off-screen → no horizontal scroll, 0 off-screen actions; mobile Delivery 1175 → no scroll; desktop Delivery 1175 px in 1082 → fits, 0 clipped actions; controls under 44 px in the mobile viewport: 5 → 0 | PASS |
| Regression suites re-run on fresh DBs: T-A1/T-A7 smoke 16/16, F-1/F-2/F-3 20/20, T-A2 scan 30/30 | PASS |
| Backend / storefront tests, `verify-all.mjs`, screen-reader testing, `code-reviewer` | NOT RUN |

### Notes
- Pre-change patch: scratch `snapshot/before-TA3-TA4.patch`. `AdminSettingsPage.tsx`, `AdminSidebar.tsx` and the other dirty files are unchanged by this batch.
- Not done (outside the approved scope): the same card layout for Payments, Inventory, Customers, Refunds, Feedback and Dashboard tables (still scroll sideways on phones; opt-in is one class + `data-label`s); page-level horizontal overflow on mobile Customers (388 px) and Dashboard (267 px) pre-exists; the mobile navigation drawer is not yet a focus-trapped dialog; Refunds desktop table (1184 px in 1082) still clips.
- Known limits: table cards use CSS `display` overrides, which some screen readers treat as non-table; the visually hidden header row stays in the DOM. ImagePreview still closes on any click inside its overlay (unchanged). Safari does not focus a button on click, so focus restore may have no target there.
- Rollback: revert the modified files and delete `useModalDialog.ts`; no data.

## 2026-10-21 — Batch 4: T-A10 Operations navigation group (owner decision D-03 + GO; defaults of N-2 used)

**Status: implemented in the working tree, NOT committed, NOT pushed, NOT deployed.** Frontend only.

### Code changes (3 files)
| File | Change |
|---|---|
| `components/AdminSidebar.tsx` (uncommitted file) | `ADMIN_NAV_GROUPS` is **untouched** (the five primary links). New export `ADMIN_OPERATIONS_GROUP` (`Operations`: Payments, Inventory, Delivery, Customers, Refunds → existing protected routes). Both groups render from one list, so the desktop sidebar and the mobile drawer share it; each group is a `role="group"` labelled by its heading. Always expanded (no collapse state). |
| `styles/admin.css` (uncommitted file; new 10-line hunk after the link-badge rule) | `.admin-sidebar__group--compact`: divider above and slightly tighter links (37 px high on desktop; the T-A3 rule keeps ≥ 44 px on touch widths). |
| `tests/admin.test.mjs` | The existing exact-five test is unchanged and still passes. New block: Operations list equals the five entries, none duplicated in the primary group, each is a real route, desktop and drawer render order (primary first), separate labelled groups, no Reports/Notifications links, active-page highlight. |

Not added (unchanged by design): pending-count badges (Phase C), links to the unrouted Reports/Notifications pages, any route or guard change.

### Verification (isolated stack, fresh DB per suite)
| Check | Result |
|---|---|
| `npm test`, `typecheck`, `build`, `git diff --check` | PASS |
| Mutation checks: drop Refunds; swap two links; remove group role | each fails a named test; restored passes |
| Browser, desktop + mobile (29 checks): sidebar order/groups, each of the 10 links lands on its page and is highlighted, mobile drawer closes after navigating, keyboard Tab/Enter through the Operations links, touch height 44 px (desktop 37 px), sidebar scrolls in a 560 px-high window, signed-out visit to `/admin/payments` still shows only sign-in | 29/29 PASS |
| Earlier suites re-run on fresh DBs (T-A4 14, F-1/2/3 20, T-A2 30, T-A1/T-A7 16) | all PASS |
| Backend / storefront tests, `verify-all.mjs`, `code-reviewer` | NOT RUN |

### Notes
- The five primary links appear in the working tree only because of the other contributor's uncommitted `Settings` hunk (HEAD has four). Commit decisions on `AdminSidebar.tsx` therefore include that hunk.
- Pre-change patch: scratch `snapshot/before-TA10.patch`. Rollback: revert the 3 files; no data.
