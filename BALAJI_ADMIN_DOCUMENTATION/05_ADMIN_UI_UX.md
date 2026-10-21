# 05 — Admin UI / UX (what exists today)

Description only; nothing here suggests changes. Evidence: `admin-panel/src/styles/globals.css`, `admin-panel/src/features/admin/styles/admin.css`, component source, and the screenshots (desktop 1440 × 900, mobile 390 × 844 at 2× pixel density). Measured values come from the running app (Chromium) and are labelled *measured*.

## 1. Overall layout

- **App shell** (`app/AdminLayout.tsx`): a skip link, then `.admin-shell` = flex row of **sidebar** (260 px) and a main column containing a sticky **top bar** (measured 65 px) and `<main id="admin-main-content">` (`.admin-workspace`, max width 1320 px, padding 28 × 24 px; 20 × 16 px ≤ 768 px; 16 × 12 px ≤ 480 px).
- Pages share one structure: `h1.page__header` (Gloock 38 px) + subtitle → optional notices → stat cards → filter card → data card/table → drawers and dialogs on demand.
- Everything outside the shell (sign-in, access-denied) uses a centred `auth-page` with the logo and a tinted `auth-card`.
- Screenshots: `desktop/dashboard__populated`, `desktop/orders__populated`, `desktop/login__empty-form`.

## 2. Navigation structure

- **Sidebar** (cream `#FFF4EA`, sticky full height): logo + black "Admin" pill → section label "ADMIN NAVIGATION" → 5 links (Dashboard, Price Management, Order Management, Feedback Management, Settings) → footer user card (name, e-mail, optional phone) → "← Customer Store" (outline button) → "Log out" (black button). Active link: white pill with orange left bar.
- Hidden from the sidebar but routed: Payments, Inventory, Delivery, Customers, Refunds (and aliases `/products`, `/reviews`). In-page links reach Payments (dashboard "Review", order drawer link) and Inventory (Price Management "Manage stock"); **Delivery, Customers and Refunds are reachable only by typing the URL**.
- No breadcrumbs, tabs, or sub-menus exist on any working page. (The unrouted Notifications page contains History/Templates/Settings chips.)
- Mobile (≤ 1024 px): sidebar becomes an off-canvas drawer opened with ☰ in the top bar; backdrop dims the page; ✕ button inside. Screenshot: `interactions/shell__sidebar-open__mobile`.

## 3. Header (top bar)

Left: ☰ (≤ 1024 px only) + global search field with magnifier icon. Right: profile pill (orange initials circle, name, e-mail), "Store" outline button, "Log out" black button. At ≤ 480 px the right group wraps to its own full-width row and the e-mail inside the pill is hidden; the search placeholder is clipped ("Search Order #BFP-1042, customer, or ph…", see `mobile/dashboard__populated`).

## 4. Colours and typography

| Token | Value | Use |
|---|---|---|
| `--color-primary` | `#FF7420` | primary buttons, active-link bar, focus accents |
| `--color-primary-dark` | `#B93C06` | headings accents, warning badge text, focus outline (3 px) |
| `--color-text` | `#141210` | body text, outline borders, dark buttons |
| `--color-text-secondary` | `#5C534B` | helper text |
| `--color-bg-cream` | `#FFF4EA` | sidebar, stat cards, table headers, tinted cards |
| `--color-border` | `#EADFD3` | card/table borders |
| `--color-green` / `-light` | `#1F7A4D` / `#E3F4EA` | "Verified / Delivered / Approved / Healthy" |
| danger | `#B42318` on `#FDECEC` | cancelled / failed / reject buttons |
| warning | `#B93C06` on `#FFF1DE` | submitted / review / awaiting |
| brown | `#7A2E1B` | info badge text |

- Fonts (Google Fonts, loaded in `index.html`): **Gloock** (serif display) for `h1/h2/h3`, **Hind Vadodara** 400–700 for UI text and Gujarati names (`lang="gu"` spans). Base size 16 px / line-height 1.5; table text smaller via `.text-small`.
- Radii: 8 / 12 / 16 / 20 / 28 px; buttons 12 px; stat cards 20 px; pills fully rounded. Shadows: almost none (`0 1px 3px rgba(0,0,0,.04)`), drawer `-8px 0 24px rgba(0,0,0,.12)`.
- Light theme only (`color-scheme: light`).

## 5. Cards, spacing, data presentation

- **Stat cards** (`StatCard`): cream rounded tile with small label, large Gloock value, grey subtitle; grid 4-across (Payments, Inventory, Refunds, Reviews), dense grid for Delivery (6 tiles, wraps 5 + 1 at 1440 px), 2 tiles (Dashboard). Not clickable anywhere (the `to` prop exists but no page passes it).
- **Filter bar** (`card--tinted customer-filters`): labelled search input + selects / date inputs + pill **chips** (`aria-pressed`) that behave like segmented filters.
- **Tables** (`data-table` inside `admin-table-wrap` / `customer-table-scroll`, `role="region"` + `tabIndex=0`): cream sticky-style header row, bold primary cell, grey secondary line under names, status badges, action cell with button groups. **Wide tables scroll horizontally inside their card** (Orders at 390 px: content 1033 px wide in a 324 px viewport; no page-level horizontal overflow — *measured*). Because action buttons sit in the last column, **the primary row actions (View, Confirm Order, Manage…) are off-screen to the right on a 390 px phone until the table is scrolled sideways** (`interactions/orders__table-scrolled-right-mobile`). At 1440 px the Delivery table's action column is partly clipped by its wrapper ("Mark Delive…", "Start Packin…" in `desktop/delivery__populated`).
- **Empty / notice** patterns: `EmptyState` card with title + description (Dashboard queue, Customers), table "No … match" rows (everything else), `Notice` banners (info, warning, error, success) with icon + title.
- **Date formats are not uniform**: Orders list "21 Oct 2026, 12:34 pm"; Dashboard `21/10/2026, 12:34:08 pm`; Payments, Inventory, Reviews, Refunds, delivery and order **timelines show raw ISO text** such as `2026-10-21T07:04:08.891908+00:00`. Currency shows as `₹1,000` (`en-IN`); unavailable prices read "Awaiting price" / "Not configured".

## 6. Forms and input controls

- Inputs share `.input` (bordered 48 px-high fields); labels above fields; helper text in `.text-small.text-secondary`. Types used: text, number (step 0.01), `type=date`, `type=search`, `type=email`, `type=tel` with `inputMode=numeric`, `type=file` (accept JPG/PNG/WEBP), textarea, select, checkbox, radio.
- Inline editing in the price table (inputs replace cell content; Save/Cancel replace Edit). Forms inside drawers use two-column `form-row` that stacks on small screens.
- Required-field marking: HTML `required` on some inputs (reason, stock quantity, refund fields, category); no asterisks.
- Validation messages: toasts (orders, prices, delivery), red `Notice` inside the drawer (payments, inventory, refunds), top banner (settings, sign-in), inline `.field-error` (profile modal).
- Screenshots: `interactions/prices__row-edit-mode`, `inventory__adjust-drawer`, `refunds__drawer-pending`, `settings__validation-pin-error`, `header__profile-modal-validation`, `login__validation-empty`.

## 7. Buttons and interaction patterns

- Variants: primary (orange fill, white text), dark (black fill), outline (white, 2 px black border), danger-outline (red), plain text button, **chips**. Sizes: normal 48 px high, `--sm` ≈ 38–40 px. Disabled style on busy/needs-input states (e.g. "Hide Review" until a reason is chosen, "Confirm payment…" while LOCAL TEST).
- Busy feedback: button label changes ("Saving…", "Approving…", "Processing…", "Please wait…", "Signing out…") and the control is disabled; the page itself is not blocked.
- Row-action groups: "View Order" outline + one dark/primary stage button + red outline "Cancel Order". After an action the **order drawer opens by itself**.
- Confirmation: `ConfirmDialog` only for order status changes; **payments, refunds, price saves, stock adjustments, review hide, settings confirm happen without an extra "are you sure" dialog** (the drawer form itself is the confirmation step).

## 8. Status badges

`StatusBadge` maps to classes: green (Delivered, Confirmed, Verified, Completed, Published, Healthy, Active), dark/black (Packed, Picked up, Shipped, Out for delivery, Repeat), info/cream (Packing, Approved), warning/amber (Awaiting confirmation, Payment review, Submitted, Under review, Pending payment (customer), Processing), outline/grey (Pending, Pending payment (order), New, Hidden, Not required), danger/red (Cancelled, Delivery failed, Rejected, Failed, Low Stock Alert), "Development price" (`badge--dev`) and "Private Bucket" outline. Unknown statuses fall back to outline with the raw text. Screenshot: `desktop/orders__populated`.

## 9. Notifications and feedback

- **Toasts** (`admin-toast-region`, fixed bottom-right, max 420 px, `role=status aria-live=polite`): tones info / success / warning / error, 4.5 s auto-dismiss, ✕ to close; several can stack.
- **Notices** (`role=alert` for errors, `role=status` otherwise): used for policy text (payments, refunds, price protection), warnings (LOCAL TEST payment, payment not verified, development data), and errors.
- Drawer headers show subtitle context (customer, phone, time).

## 10. Loading, empty, success and error states (all captured)

| State | Where | Look | Screenshot |
|---|---|---|---|
| Loading | every page | 3–6 shimmering cream bars (`LoadingSkeleton`) | `interactions/dashboard__loading-skeleton` (+`__mobile`) |
| Empty | Dashboard queue, Customers search, every table | EmptyState card / table row text | `desktop/dashboard__empty-state`, `interactions/customers__search-no-results`, `orders__search-no-results` |
| Server unreachable | pages | red ErrorState "Unable to load live data" + Retry request (Dashboard, Customers, Settings, Prices, Inventory) or a Notice without retry (Orders, Payments, Delivery, Refunds, Reviews) | `interactions/dashboard__error-network`, `orders__error-500` |
| Success | after actions | green toast / success Notice | `orders__after-confirm-toast`, `refunds__after-complete` |
| Validation | forms | see §6 | listed there |
| Access denied | guard | "Owner Admin Access Only" card | `guard__role-check-failed`, `guard__customer-role-denied` |

## 11. Modals, drawers and dialogs

- **Drawer** (`DetailDrawer`): right-aligned panel, width `min(640px, 100vw)` (full width ≤ 768 px), sticky header (title, subtitle, Close), scrolling body, optional footer; opened by row buttons; closes by Close, Escape or backdrop click. Used by Orders, Payments, Prices (product details), Inventory (adjust), Delivery, Customers, Reviews, Refunds.
- **Modal dialogs** (`.admin-modal` on `.admin-overlay`): `ConfirmDialog` (Orders), profile modal (header), image enlarge (`ImagePreview`). Escape closes ConfirmDialog (unless busy) but **not** the profile modal or the enlarged image (verified for the profile modal; the image overlay only handles clicks).
- No focus trap, initial-focus or focus-return logic was found in `ConfirmDialog` / `DetailDrawer` source (not tested with a screen reader).

## 12. Responsive behaviour (breakpoints in `admin.css` / `globals.css`)

| Width | Change |
|---|---|
| ≤ 1100 px | store-wide layout tweaks in `globals.css` (reviews/payment grids) |
| ≤ 1024 px | sidebar → off-canvas drawer, ☰ shown |
| ≤ 768 px | KPI grid one column, workspace padding 20/16, drawers full-width |
| ≤ 540 / 480 px | stat grids one column, top-bar wraps, profile e-mail hidden |
| ≤ 375 px | additional compact rules in `globals.css` |
| print | sidebar/top bar hidden (`@media print`) |

Mobile screenshots exist for every page in empty and populated states (`screenshots/mobile/`), plus drawer/dialog/profile examples under `interactions/*__mobile`. Observed on mobile: tables scroll sideways inside cards; the top-bar search is clipped; 45 controls on the Orders page are under 44 px in at least one dimension (e.g. ✕ 36×36, ☰ 40×40, outline buttons 40 px high) — *measured*.

## 13. Accessibility that can be observed or verified

Verified by test or code:
- Skip link "Skip to admin content" is the first Tab stop and moves focus to `#admin-main-content` (tested).
- Landmarks: one `nav`, one `aside` (labelled "Admin module navigation"), one `header`, one `main` (measured); `<html lang="en">`; Gujarati text carries `lang="gu"`.
- Tables: `<th scope="col">`, scroll regions have `role="region"`, `aria-label`, `tabIndex=0`.
- Dialogs/drawers use `role="dialog" aria-modal="true"` with `aria-labelledby`; chips use `aria-pressed`; stars have `aria-label="N out of 5 stars"`; visually-hidden labels (`.sr-only`) for icon-only columns; toast region `aria-live=polite`, error notices `role=alert`.
- Focus ring: global `:focus-visible` outline 3 px `#B93C06` offset 3 px; `prefers-reduced-motion` rules present.
- Not verified: colour contrast ratios, screen-reader announcements, keyboard trap behaviour inside open dialogs (NOT TESTED).

## 14. Page → screenshot map

| Page | Route | Desktop | Mobile | Interaction shots |
|---|---|---|---|---|
| Sign-in / guard | `/admin` | `desktop/login__*` | `mobile/login__*` | `guard__*`, `auth__after-logout` |
| Dashboard | `/admin/dashboard` | `dashboard__empty-state`, `__populated` | same names | `dashboard__loading-skeleton`, `__error-network`, `__review-link-opens-payment-drawer` |
| Price Management | `/admin/prices`, `/admin/products` | `prices__*`, `products__*` | same | `prices__*` (8) |
| Order Management | `/admin/orders` | `orders__empty-state`, `__populated` | same | `orders__*` (20) |
| Payment Screenshots | `/admin/payments` | `payments__*` | same | `payments__*` (10) |
| Inventory | `/admin/inventory` | `inventory__*` | same + `__after-workflows` | `inventory__*` (4) |
| Delivery | `/admin/delivery` | `delivery__*` | same | `delivery__*` (6) |
| Customers | `/admin/customers` | `customers__*` | same + `__after-workflows` | `customers__*` (3) |
| Feedback / Reviews | `/admin/feedback`, `/admin/reviews` | `feedback__*`, `reviews__*` | same | `feedback__*` (4) |
| Refunds | `/admin/refunds` | `refunds__*` | same + `__after-workflows` | `refunds__*` (5) |
| Settings | `/admin/settings` | `settings__*` | same | `settings__*` (4) |
| Hidden routes | `/admin/reports`, `/admin/notifications` | `hidden-routes__redirect-to-dashboard` | same | — |
