# Balaji Faki Point — Admin Panel Documentation Snapshot

Purpose: an accurate, evidence-based description of the **current demo Admin Panel**, so another reviewer (human or AI) can understand what was actually built. It documents; it does **not** recommend, redesign, fix or extend anything. No application source file was modified to produce it.

## Contents

| File | What it holds |
|---|---|
| `01_ADMIN_FEATURES.md` | 37 features (F-xx): page/route, what is shown, controls, validation, API, data source, works?, source files, screenshots |
| `02_ADMIN_BUSINESS_RULES.md` | 86 implemented rules (R-xxx-nn) with condition, trigger, success/failure, role, source function, status |
| `03_ADMIN_LOGIC.md` | what each click does end to end (request → validation → saved tables → UI state → errors → customer effect) |
| `04_ADMIN_WORKFLOWS.md` | 12 workflows with Mermaid diagrams |
| `05_ADMIN_UI_UX.md` | layout, navigation, colours, typography, components, states, responsive and accessibility facts |
| `06_TECHNICAL_ARCHITECTURE.md` | stack, auth, API endpoint table, tables/ERD, storage, integrations, feature→source map |
| `07_FUNCTIONALITY_STATUS.md` | per-feature verdict + the full log of 93 runtime tests + automated suite results |
| `08_SCREENSHOT_INDEX.md` | every screenshot with page, route, state, viewport, description; what could not be captured |
| `screenshots/desktop/` (29) · `mobile/` (33) · `interactions/` (89) | 151 PNG files |

## Headline numbers

- **Admin pages**: 10 working pages (Dashboard, Price Management, Order Management, Payment Screenshots, Inventory, Delivery, Customers, Feedback Management, Refunds, Settings) served by 12 routes (two aliases: `/products`, `/reviews`), plus 2 page components that exist but are unreachable (Reports, Notifications — routes redirect to the dashboard, backend endpoints missing) and the sign-in / access-denied gate screens. Only 5 pages are in the sidebar; Delivery, Customers and Refunds have no link anywhere in the UI.
- **Screenshots**: 151 (1440 × 900 desktop, 390 × 844 mobile).
- **Features documented**: 37. **Business rules**: 86. **Workflows**: 12.
- **Verification**: 93 recorded runtime tests (82 pass, 6 observations, 3 partially implemented behaviours, 1 broken, 1 mock/demo) + Admin Panel `npm test` PASS + `typecheck` clean + backend `unittest` 110/110 OK (1 test fails only when the storage environment variables are blank).

## How the evidence was produced

1. Read the whole admin front end, the admin back end routes, domain rules, models and migrations README.
2. Ran the **unmodified** app locally and drove it with Playwright (Chromium).
3. Environment: backend on a throw-away **SQLite** file (`BFP_ENV=local`), project dev seed, 20 demo orders created through the real API endpoints; object storage replaced by a local folder (the one function the project's own tests also replace); admin login used a **throw-away** email/password that existed only in that process. Neon database/Auth/Storage, Vercel and production were **never contacted**; no real payments, e-mails or customers were involved. Data shown is fictitious (`@example.test`, phone numbers `98000000xx`, images labelled "DEMO").
4. Every mutation made through the UI was re-read from the API (and from the public API for customer-visible effects).
5. The demo database was created from scratch inside a scratch folder outside the repository and is not part of this package.

## Snapshot identity (important)

- Git HEAD: `0a69f7e` ("deleviry and payment method added").
- The working tree had **18 uncommitted modified files** when documentation started (admin: `index.html`, `AdminSidebar.tsx`, `admin.css`, `globals.css`, `tests/admin.test.mjs`; backend: `core/storage.py` + 2 tests; docs; storefront files). This documentation describes the working tree, not HEAD.
- **While this was being produced, `admin-panel/src/features/admin/pages/AdminSettingsPage.tsx` was modified by someone else** (not by this task): the "no changes" feedback became a toast ("No changes to save. Your settings are already saved."), the error banner title became "Could not complete action", "Confirm" now refuses with unsaved edits, QR/photo updates keep unsaved text. Docs describe the version on disk at the end; Settings screenshots were re-captured after the change, but a few earlier Settings interaction shots were taken during the transition and may show either wording.
- Fingerprint of the admin pages + `orderStateMachine.ts` + backend `routes/` and `core/` at the end of the session: `sha256 fb6eab5af53e17b3fe67fcc6844a6c82121b4b764c3e3a9f61845674d851630a` (concatenated per-file `sha256sum` output).

## Limitations and caveats

- Real Neon Auth customer sessions, real object storage, the production ordering gate (settings + price approval required outside local mode), real bank/UPI payments and the storefront UI were **not** tested.
- Statements marked INFERRED/UNKNOWN/NOT TESTED in the documents are exactly that; nothing was assumed to work because the UI looks right.
- The Reports and Notifications pages cannot be shown without editing source, so they are documented from code only and labelled MOCK / DEMO.
- Role (CUSTOMER) denial and loading/error screens used browser-side request stubbing; these are labelled in the screenshot index.
- Timestamps in screenshots reflect the demo run date (21 Oct 2026, IST).
- A login-throttle test intentionally locked the demo server's login for a while; the demo server was restarted afterwards.

## Suggested reading order for a reviewer

`01` (what exists) → `03` (what it really does) → `02` (rules) → `07` (what works / broken) → `04`, `05`, `06` as needed; use `08` to find the matching picture.
