# Balaji Faki Point — Online Store & Owner Admin Panel

Online ordering for **Balaji Faki Point** (Faki, Supari, Mitho Mavo, Water, Chuno, Tamaku): a customer storefront, a separate Owner Admin Panel and a FastAPI backend, deployed on Vercel and running on **Neon** (Postgres, Neon Auth sign-in, Object Storage).

## 1. Technology stack

- **Storefront** (`frontend/`): React 19, TypeScript, Vite 6, React Router 7, custom CSS (orange/cream Balaji branding, `Gloock` headings, `Hind Vadodara` body, Gujarati names).
- **Admin Panel** (`admin-panel/`): a separate, self-contained Vite app (own `package.json`, sources and tests), like D&D's `Admin/`.
- **Backend** (`backend/app/`): Python FastAPI + SQLAlchemy 2 + Pydantic 2, served on Vercel by `api/index.py`. One API for both apps; routes are split by area in `backend/app/routes/`.
- **Neon**: Postgres (schema in `backend/migrations/neon/`), Neon Auth (email + password, emailed verification and reset codes), Object Storage (private `assets` bucket). Project settings: `neon.ts`, link: `.neon`.

## 2. Project structure

```text
Balaji Faki Website/
├── frontend/                 # customer storefront (Vite + React), own package.json, builds to frontend/dist
│   ├── public/images/        # product, hero and brand images
│   ├── src/
│   │   ├── app/              # App shell and routes
│   │   ├── components/       # common (EmailSignIn, ProductName, Modal, ...) and layout
│   │   ├── context/          # OrderContext: account-scoped checkout draft
│   │   ├── features/         # catalog, orders, payments, reviews, store, help, account
│   │   ├── lib/              # api.ts (fetch + bearer token), auth.ts (Neon Auth), profile.ts, contracts.ts, env.ts
│   │   └── styles/globals.css
│   └── tests/                # checkout, secondary pages, auth, orders
├── admin-panel/              # Owner Admin Panel, self-contained (own package.json, src/, public/, tests/)
│   ├── src/                  # app/ (routes under /admin), features/admin/, lib/, components/common/, styles/
│   ├── tests/admin.test.mjs
│   └── vercel.json           # admin Vercel project (Root Directory: admin-panel)
├── backend/
│   ├── app/
│   │   ├── main.py           # creates the FastAPI app and mounts the routes
│   │   ├── routes/           # public, account, orders, payments, reviews, admin, admin_orders, admin_payments, admin_catalog, common
│   │   ├── core/             # config, security (Neon Auth JWTs), storage (Neon Object Storage)
│   │   └── db/               # models, session, seed
│   ├── migrations/neon/      # numbered SQL migrations (applied by scripts/setup-neon-db.py)
│   └── tests/                # unittest suite (SQLite)
├── api/index.py              # Vercel entrypoint for the FastAPI app
├── scripts/                  # setup-neon-db.py, e2e-neon-dev.py, migrate-supabase-to-neon.py, verify-all.mjs, ...
├── docs/                     # VERCEL_DEPLOYMENT.md (deploy + cutover), NEON_SETUP.md, API contracts, design reference
├── neon.ts                   # Neon services: Postgres, Auth, Object Storage
└── vercel.json               # storefront + API Vercel project
```

## 3. Commands

Each app installs and runs on its own (like D&D):

```powershell
cd frontend;    npm install; npm run dev     # store        http://localhost:5173
cd admin-panel; npm install; npm run dev     # admin panel  http://localhost:5174/admin
python -m uvicorn app.main:app --app-dir backend --port 8000   # API, from the repo root
```

Checks: `npm run typecheck`, `npm test`, `npm run build` inside `frontend/` and inside `admin-panel/`;
`python -m unittest discover -s backend/tests` from the root; `node scripts/verify-all.mjs` runs all of them.

## 4. Local development with Neon

Sign-in needs a real Neon Auth, so develop against a **Neon branch**, never `production`:

```powershell
neon branches create --name dev --parent production
neon env pull --branch dev --file .env.neon-dev      # gitignored
python scripts/setup-neon-db.py --project-id spring-mode-09495880 --branch dev --env-file .env.neon-dev
```

Start the API with that file's variables in the environment (they take precedence over `.env`), plus `VITE_NEON_AUTH_URL` (= `NEON_AUTH_BASE_URL`) and `VITE_API_BASE_URL=http://127.0.0.1:8000/api` for the frontends; see `.env.example` for every variable. `python scripts/e2e-neon-dev.py .env.neon-dev` then runs the full order and payment flow against the branch. Delete the branch when done (`neon branches delete dev`).

The backend unit tests need nothing external: they run on SQLite with stubbed tokens and storage.

Rules the code enforces:

- Request handlers never invent prices, stock or settings; new products start unpriced and out of stock until the owner sets them.
- Checkout stays closed until the owner confirms prices and payment settings in Admin → Settings.
- Roles come only from `public.user_profiles` on the server; the browser never decides who is Owner Admin.
- Uploaded payment screenshots and review photos are private and only served through the API.
- Never put `DATABASE_URL`, `AWS_*` or `PROOF_SIGNING_SECRET` in `VITE_*` variables (those reach the browser).

## 5. Documentation

- [Deploying to Vercel on Neon, and the Supabase cutover](docs/VERCEL_DEPLOYMENT.md)
- [Neon setup notes](docs/NEON_SETUP.md)
- [Database migrations](backend/migrations/neon/README.md)
- [API contracts](docs/api/api-contracts.md)
- [UI design reference](docs/design-reference/README.md)
