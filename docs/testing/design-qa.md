# Design QA — Balaji Faki Point

final result: passed

Scope: the implemented frontend, disconnected/empty states and isolated static payment-component fixtures. Live email authentication/payment/order-confirmation integration is NOT verified and remains blocked until the services described in docs/backend-integration.md exist. This result is not a claim that the site can take live orders or payments. The 68 page-layout checks below preceded the later mandatory entry-login requirement; authentication checks are recorded separately.

## Visual source and evidence

Source truth: `frontend/Balaji Faki Point – Website UI-png (1)/` (all 13 supplied PNGs) and corresponding original HTML files. Exact logo and product assets were extracted from 01-Home.html, not redrawn or generated.

The source images are 2560px wide; comparisons normalize them to a 1280px CSS viewport. Reference heights at 2x density include Home 3280px, Order 2360px, Reviews 3800px, Store 1720px, Help 2080px, Customers 2596px. Browser captures used corresponding CSS heights (1640, 1180, 1900, 860, 1040, 1298). Captures can be 1264–1280px wide depending on the vertical scrollbar; comparisons normalize both images to 640px per column and do not score scrollbar differences as layout bugs.

Full comparisons saved and opened: verification/compare-home.png, compare-order.png, compare-reviews.png, compare-store.png, compare-help.png, compare-customers.png. Focused source/implementation comparison: verification/compare-verification-panel.png. The verification reference crop is (568,338)–(1992,1442) in the original 2x PNG; the actual component panel was captured at its DOM bounds in an isolated, explicitly labelled static test fixture.

Representative final screenshot: verification/home-final.png (1440x900); final mobile: verification/home-375.png. Responsive measurements: verification/responsive-checks.json. Payment layout fixture images: verification/fixture-payment-1280.png and fixture-verification-1280.png. These fixtures do not create orders or make payments and are not bundled into production.

## Comparison history

1. Baseline: imitation logo, unrelated hero photograph, orange product titles instead of dark orange, white order-summary card, oversized page headings, incomplete tracking/search controls, emoji substitutions and sample payment states presented as real. Reused original assets and existing CSS tokens; matched title hierarchy, card colors, pack labels and footer.
2. First render comparison: Admin logo inherited intrinsic height and overflowed the header; review sidebar was too narrow; FAQ cards were too compressed; form fieldset spacing accumulated. Fixed explicit logo height, reference column proportions, FAQ padding and form margins, then recaptured and opened the updated comparisons.
3. Responsive pass: Admin Customers table leaked horizontal scroll into the document at 375/768px. Scoped its accessible hidden text to the scroll region and retained table scrolling inside the panel. Retested both widths; all 68 route/width measurements now have document scrollWidth no larger than the viewport.
4. Final mobile inspection: navigation wraps so all seven links stay visible, five checkout steps stay legible, form and summary stack, and the footer wraps without clipping. Keyboard Skip to content focuses main-content.

## Required fidelity surfaces

- Typography: Gloock headings and Hind Vadodara body; Gujarati form input was entered, reviewed, navigated back and restored after refresh. Headings, line wrapping and panel hierarchy compared against supplied images.
- Spacing/layout: original centered wrappers, hero image treatment, section rhythm, cream summaries, rounded border cards, footer and review grid retained. All routes inspected at 1440,1024,768,375px.
- Colors/tokens: retained #FF7420, #B93C06, #141210, #5C534B, #FFF4EA, #EADFD3 and #1F7A4D.
- Assets: original raster logo and sliced-supari photograph, original outline-icon paths, no fabricated brand illustration or payment destination.
- Copy/content: main reference headings/navigation/CTAs retained. Unknown prices say Awaiting price; example data is labelled; no invented opening hours, successful payment or verified customer order.

## Deliberate requirement-driven differences

Email/password sign-in and completed name/mobile contact details are required at website entry, per the updated requirement. The new login/profile screens use the supplied logo, fonts, colors and card styles. Missing backend states show authentication/unavailable guidance instead of the reference's fictitious paid orders. Review confirmation starts unchecked. Payment screenshots are required (the reference said optional). No official QR or fabricated timer appears without server instructions/expiry. Demo review badges say Reference example, and admin figures are labelled samples or unknown. Admin Back to store is a real navigation link, not a fake logout. These differences preserve the requested safety and functional requirements.

## Browser interaction results

PASS: Home product preselection; invalid form errors/focus; product/pack/quantity changes; Gujarati details; Order → Review → browser Back; refresh persistence; disabled payment without backend even when checkbox checked; no success on direct payment/verification/confirmation routes; FAQ search; review area filter/form validation/focus/truthful disconnected submission; customer search/detail panel; 404; keyboard skip link; fresh preview console errors/warnings empty.

## Remaining verification limits

Email/password update checks (17 October 2026): real login screen and isolated static profile layout fit 1440/1024/768/375px without document overflow. Eight direct checkout/customer/admin URLs display login instead of store navigation. Invalid email/empty password are blocked by native form validation; switching sign-in/create-account works. Final preview console errors/warnings were empty. Profile/session gates, profile save failure handling and account-separated draft restoration passed isolated automated tests. No successful live login was simulated in the production app. Evidence: verification/email-auth-browser-checks.json, email-login-1440.png, email-login-375.png, customer-profile-1440.png and customer-profile-375.png.

No live account was created, email sent or password submitted. No actual payment/order was created or marked verified. The real QR/upload/verification sequence, authenticated ownership enforcement, bank-credit approval, private Supabase storage and Vercel deployment cannot be exercised until configured services exist. The static fixtures verify component layout only. Full WCAG compliance, physical device testing, dependency security scanning and all browser engines were not audited.

P3: small platform font-rasterization/scrollbar differences and spacing added by truthful development/authentication notices remain expected. No actionable P0/P1/P2 layout issue remains in the tested frontend states.
