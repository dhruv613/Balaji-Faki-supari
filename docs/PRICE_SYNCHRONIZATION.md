# Price and inventory synchronization repair — 20 October 2026

## Verified causes and changes

- `OrderContext` used `PRODUCT_SHELL` at startup and after any catalog failure. The Home page rendered its null prices as “Awaiting price”, masking API, configuration and response errors. The catalog now starts empty, exposes the real error with Retry, and renders only API products. Product details use the same catalog. Malformed catalog responses now name product/price information rather than order/payment information.
- Both env helpers used `??`: an explicitly empty `VITE_API_BASE_URL` overrode the production `/api` default and disabled requests. Missing development values also disabled requests. Both apps now trim the setting and fall back identically: `/api` in production, `http://127.0.0.1:8000/api` in development.
- An approved pack's checkbox stayed checked when its selling price changed. Unchecking it did not send `priceConfirmed: false`. Price edits now clear approval; the owner must explicitly check approval again. Saving an unapproved change and later approving it both work. Revocation persists.
- “On sale” previously reflected only the merchant toggle, even with zero stock or pending approval. Price Management now distinguishes off sale, zero stock, missing price and missing approval. The customer cannot select an unapproved or out-of-stock pack.
- Catalog fetching ran only once per provider mount. It now refreshes on route return, window focus, restored-page display, tab visibility and every 60 seconds while visible; overlapping refreshes are suppressed and stale results after unmount ignored. Relevant catalog changes also refresh the server quote. Existing order totals still take precedence.
- Catalog/inventory GETs now use `cache: no-store` in the clients and `Cache-Control: no-store` in FastAPI. Admin loading failures finish and offer Retry. Inventory adjustments re-read the server and notify existing admin listeners. A successful stock write followed by a failed read is explicitly reported as saved, so retrying the read cannot duplicate the adjustment.

The backend PATCH already commits to the shared SQLAlchemy session and resets approval when prices change. Public serialization already exposes database prices independently of stock and approval, while production checkout enforces both. No price database, migration, seed, hardcoded price or order repricing was added.

## Routing verified

`vercel.json` serves FastAPI through `/api/index` before the SPA fallback. `admin-panel/vercel.json` forwards `/api/*` to `https://balaji-faki-point.vercel.app/api/*`. Both configurations were inspected and left unchanged.

Read-only public HTTP checks on 20 October 2026 returned HTTP 200 from both sites' `/api/products` and the store's `/api/health`. The two catalog responses matched on all six products' pack sizes, prices, approval flags, stock flags and per-kg rates. They contained 15 priced packs, 3 approved packs and 15 in-stock packs. These are observations of the existing deployment, not post-deployment acceptance of this local fix. Private deployment variables and the live Neon branch identity were not read or changed; identical public results do not prove a database's identity.

## Manual environment configuration

Production browser configuration:

| Variable | Storefront project | Admin project |
|---|---|---|
| `VITE_API_BASE_URL` | `/api` | `/api` |
| `VITE_NEON_AUTH_URL` | Existing production Neon Auth URL, same as API `NEON_AUTH_BASE_URL` | Not needed; admin uses the API's fixed login |
| `VITE_ADMIN_URL` | `https://balaji-faki-point-admin.vercel.app` | Optional |
| `VITE_STORE_URL` | Optional | `https://balaji-faki-point.vercel.app` |

`VITE_API_BASE_URL` may be unset/blank after this fix; the explicit `/api` value makes the intended routing clear. Replace stale localhost or alternate-backend overrides. If the store moves domains, update the admin `/api/*` and `/images/*` rewrite destinations together. For a separate external FastAPI deployment, set **both** browser API URLs to the same `https://<backend-host>/api` and set API `CORS_ORIGINS` to the two exact browser origins, comma separated. Do not put browser domains in `DATABASE_URL`.

Server settings belong **only** to the storefront/API Vercel project:

| Variable | Required value |
|---|---|
| `DATABASE_URL` | Existing intended branch's pooled Neon PostgreSQL URL; secret, never `VITE_*` |
| `BFP_ENV` | `production` (also the unset default); never `local` on a deployed site |
| `NEON_AUTH_BASE_URL` | Existing same-branch Neon Auth endpoint |
| `NEON_AUTH_JWKS_URL` | Existing same-branch JWKS URL (`<NEON_AUTH_BASE_URL>/.well-known/jwks.json`) |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Existing owner login; server only, password at least 10 characters |
| `PROOF_SIGNING_SECRET` | Existing strong signing secret, at least 32 characters |
| `AWS_ENDPOINT_URL_S3`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | Existing same-branch object-storage configuration |
| `CORS_ORIGINS` | Existing localhost defaults suffice with the production same-origin API proxies; external backend setups need exact storefront/admin origins |

Keep valid existing credentials. No secret rotation is needed for this fix. The static admin project needs no database credentials. `DATABASE_URL_UNPOOLED` is for deliberate schema work, not this repair; no migration is required. `DATABASE_URL` takes priority over the legacy `POSTGRES_URL` alias.

Local development: set `VITE_API_BASE_URL=http://127.0.0.1:8000/api` in **both** `frontend/.env.local` and `admin-panel/.env.local` (or use the matching new defaults). Vite reads env files from each app's root; the repository-root browser setting alone does not configure these apps. Configure the API once in the repo root's gitignored environment with an isolated development Neon branch. Do not use production credentials for testing.

```powershell
# Run from the repository root, in separate terminals:
python -m uvicorn app.main:app --app-dir backend --port 8000
npm --prefix frontend run dev
npm --prefix admin-panel run dev
```

For local acceptance of production approval rules, use `BFP_ENV=production` with development branch credentials and owner-confirmed test settings. Existing `BFP_ENV=local` conveniences bypass the backend's pack/settings confirmation guard; they were not expanded by this repair. The storefront now prevents selecting unapproved packs even in local mode.

## Manual deployment and acceptance

1. Review and publish the local changes through your normal Git workflow. No commit, push or deployment was performed here.
2. In Vercel, confirm storefront Root Directory is the **repository root**, and admin Root Directory is **`admin-panel`**. Keep the checked-in build/output settings; do not deploy the storefront with Root Directory `frontend`, which would omit the Python function.
3. Configure Production variables above. For Preview/staging, use a separate development backend and Neon branch. Override the admin Preview API URL to that staging backend: the checked-in admin proxy intentionally targets the production store. Never test writes through that proxy against production.
4. Deploy storefront/API first and then admin. Check `/api/health` and `/api/products` on each site's API path. After deployment, catalog and inventory responses must include `Cache-Control: no-store`. Browser env changes require a rebuild/redeployment; later database price/stock edits do not.
5. On the isolated staging branch, edit a pack's selling price and Save with approval unchecked. Confirm “Development price” and blocked production-mode checkout. Edit again, check approval and Save; confirm “Approved” and the same value in the customer catalog.
6. In **Price Management → Manage stock**, select the matching product/pack, choose **ADD**, enter the actual quantity and a reason, then submit once. Confirm the movement log and available quantity. The product and pack must also be active/on sale, priced and approved. Stock is pack units; held/reserved units are not available stock.
7. Return to the customer tab, refresh, and verify price and availability. Repeat after a backend restart/redeployment. Simulate an unreachable API and confirm an explicit error with Retry. Check a previously purchased order still has its original unit price and total.
8. Use the ordinary authenticated admin UI for any real stock/price/approval updates once staging acceptance succeeds. No production database repair or automatic bulk approval is included.

## Preserved semantics and limits

All six products remain database driven: Faki, Supari, Mitho Mavo, Water Bottle, Chuno and Tamaku, with their existing pack sizes. Typed weights retain the existing per-kg calculation, 100 g–10 kg range, 50 g steps and rounding. Existing typed-weight orders intentionally do not use pack inventory and have no separate price-approval flag; this repair does not invent bulk inventory or change that business model. Zero-stock **packs** remain rejected by server checkout. Server-side checkout pricing, owner authentication, historical snapshots and product restrictions remain intact.

Live Neon/PostgreSQL transaction behavior, a real process restart, deployed browser acceptance and the private runtime database identity still need staging verification. The automated restart check disposes/reopens an isolated SQLite engine against the same file; it is not a live Neon restart test.

## Verification

| Check | Result |
|---|---|
| `npm --prefix frontend test` | PASS: checkout, secondary pages, authentication, orders, new catalog regression suite |
| `npm --prefix frontend run build` | PASS, includes TypeScript check |
| `npm --prefix admin-panel test` | PASS, including approval callbacks, load failure/retry, stock adjustment and saved-write/read-failure regression |
| `npm --prefix admin-panel run build` | PASS, includes TypeScript check |
| `python -m unittest discover -s backend/tests` | PASS: 106 tests; isolated SQLite and mocked external services |
| Public deployed catalog comparison and health | PASS: HTTP 200, matching six-product catalogs; read only |
| `git diff --check` | PASS |
| Live Neon/PostgreSQL integration, new deployment and real browser walkthrough | NOT RUN; manual staging acceptance required |

The actual HTTP regression covers owner/customer authorization, price change → pending approval → approval, zero-stock rejection, inventory ADD → public availability, new-order pricing, historical-order snapshots, persistence across database reconnect and approval revocation. Existing backend tests cover all catalog products and typed weights. No required check currently fails. Vite builds retain nonfatal dependency annotation/chunk warnings.

Backend HTTP tests required execution outside the shell sandbox because asyncio's internal local socketpair was blocked. They forced `DATABASE_URL=sqlite:///:memory:` before importing the app and used writable local temporary files; no production database was contacted.

Provider documentation checked: [Vercel rewrites](https://vercel.com/docs/routing/rewrites), [Vercel environment variables](https://vercel.com/docs/environment-variables), [Vite 6 environment variables](https://v6.vite.dev/guide/env-and-mode).

## Modified files (24)

Admin:

- `admin-panel/src/features/admin/api/index.ts`
- `admin-panel/src/features/admin/pages/AdminProductsPage.tsx`
- `admin-panel/src/features/admin/pages/AdminInventoryPage.tsx`
- `admin-panel/src/lib/env.ts`
- `admin-panel/tests/admin.test.mjs`

Backend:

- `backend/app/routes/admin_catalog.py`
- `backend/app/routes/public.py`
- `backend/app/routes/common.py`
- `backend/tests/test_admin_http_contract.py`

Storefront:

- `frontend/package.json`
- `frontend/src/context/OrderContext.tsx`
- `frontend/src/features/catalog/api/catalogApi.ts`
- `frontend/src/features/catalog/components/ProductParts.tsx`
- `frontend/src/features/catalog/components/ProductDetailsView.tsx`
- `frontend/src/features/catalog/pages/HomePage.tsx`
- `frontend/src/features/catalog/pages/ProductDetailsPage.tsx`
- `frontend/src/features/orders/pages/OrderFormPage.tsx`
- `frontend/src/features/orders/pages/ReviewOrderPage.tsx`
- `frontend/src/lib/api.ts`
- `frontend/src/lib/contracts.ts`
- `frontend/src/lib/env.ts`
- `frontend/tests/checkout.test.mjs`
- `frontend/tests/catalog.test.mjs` (new)

Documentation:

- `docs/PRICE_SYNCHRONIZATION.md` (new)
