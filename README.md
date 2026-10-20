# Balaji Faki Point — Online Store & Owner Admin Panel

Online ordering for **Balaji Faki Point** (Faki, Supari, Mitho Mavo, Water, Chuno, Tamaku): a customer storefront, a separate Owner Admin Panel and a FastAPI backend, deployed on Vercel and running on **Neon** (Postgres, Neon Auth sign-in, Object Storage).

## 1. Technology stack

- **Storefront** (`frontend/`): React 19, TypeScript, Vite 6, React Router 7, custom CSS (orange/cream Balaji branding, `Gloock` headings, `Hind Vadodara` body, Gujarati names).
- **Admin Panel** (`admin-panel/frontend/`): its own Vite app; reuses the storefront's shared code from `frontend/src` via the `@shared` alias.
- **Backend** (`backend/app/`): Python FastAPI + SQLAlchemy 2 + Pydantic 2, served on Vercel by `api/index.py`.
- **Neon**: Postgres (schema in `backend/migrations/neon/`), Neon Auth (email + password, emailed verification and reset codes), Object Storage (private `assets` bucket). Project settings: `neon.ts`, link: `.neon`.

## 2. Project structure

```text
Balaji Faki Website/
├── frontend/                 # customer storefront (Vite + React)
│   ├── public/images/        # product, hero and brand images
│   ├── src/
│   │   ├── app/              # App shell and routes
│   │   ├── components/       # common (EmailSignIn, ProductName, Modal, ...) and layout
│   │   ├── context/          # OrderContext: account-scoped checkout draft
│   │   ├── features/         # catalog, orders, payments, reviews, store, help, account
│   │   ├── lib/              # api.ts (fetch + bearer token), auth.ts (Neon Auth), profile.ts, contracts.ts, env.ts
│   │   └── styles/globals.css
│   └── tests/                # checkout, secondary pages, auth, orders
├── admin-panel/
│   ├── frontend/             # Owner Admin Panel (pages under /admin), tests/admin.test.mjs
│   ├── backend/README.md     # the admin API is the shared backend
│   └── vercel.json           # admin Vercel project (Root Directory: admin-panel)
├── backend/
│   ├── app/                  # FastAPI app: main.py, core/ (config, security, storage), db/ (models, session, seed)
│   ├── migrations/neon/      # numbered SQL migrations (applied by scripts/setup-neon-db.py)
│   └── tests/                # unittest suite (SQLite)
├── api/index.py              # Vercel entrypoint for the FastAPI app
├── scripts/                  # setup-neon-db.py, e2e-neon-dev.py, migrate-supabase-to-neon.py, verify-all.mjs, ...
├── docs/                     # VERCEL_DEPLOYMENT.md (deploy + cutover), NEON_SETUP.md, API contracts, design reference
├── neon.ts                   # Neon services: Postgres, Auth, Object Storage
└── vercel.json               # storefront + API Vercel project
```

## 3. Commands

```powershell
npm install
npm run dev            # storefront  http://localhost:5173
npm run dev:admin      # admin panel http://localhost:5174/admin
npm run typecheck
npm test               # 5 frontend suites (storefront + admin)
python -m unittest discover -s backend/tests
npm run build; npm run build:admin
npm run verify         # Neon config check + typecheck + tests + backend tests + both builds
```

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
