# Balaji Faki Point — E-Commerce Store & 12-Module Admin Management Panel

Local-development e-commerce ordering website and Owner Admin Management Panel for **Balaji Faki Point** (online Faki & Supari ordering), built with React 19, TypeScript, Vite 6, React Router v7, and Supabase PostgreSQL.

---

## 1. Technology Stack

- **Frontend**: React 19 + TypeScript + Vite 6 + React Router v7 + custom CSS design tokens (`#FF7420`, `#B93C06`, `#141210`, `#5C534B`, `#FFF4EA`, `#EADFD3`, `#1F7A4D`, `Gloock` headings, `Hind Vadodara` body, Gujarati support).
- **Database & Platform**: Local Supabase PostgreSQL with Row-Level Security (RLS), private Storage bucket (`payment-proofs`), and operational tables.
- **Target Backend**: Python FastAPI + SQLAlchemy 2.0 + Pydantic v2 + Alembic (contracts defined in [`docs/api/api-contracts.md`](docs/api/api-contracts.md)).
- **Deployment**: Not part of this local-development workflow.

---

## 2. Project Structure

```text
Balaji Faki Website/
├── .agents/                    # AI Agent skills (supabase, supabase-postgres-best-practices, supabase-server)
├── backend/                    # Backend workspace (@supabase/server, .env.example, FastAPI target layout)
├── docs/                       # Comprehensive project documentation & preserved UI references
│   ├── architecture/           # System architecture & Mermaid integration diagram
│   ├── api/                    # Customer & Admin (24 endpoints) API contracts
│   ├── database/               # 18 PostgreSQL tables, RLS policies & migration guide
│   ├── deployment/             # Vercel & Supabase setup checklist
│   ├── design-reference/       # Original HTML, PDF & 2x PNG UI design references + route map
│   ├── testing/                # Automated test suites, results, design-qa.md & verification fixtures
│   ├── backend-integration.md  # Full FastAPI & Supabase integration specification
│   └── implementation-report.md
├── frontend/                   # React 19 + TypeScript + Vite Frontend Application
│   ├── public/
│   │   ├── favicon.svg
│   │   ├── icons/
│   │   ├── images/             # Brand logo & product imagery
│   │   └── logos/
│   ├── src/
│   │   ├── main.tsx            # Application bootstrap
│   │   ├── app/
│   │   │   ├── providers/      # AppProviders (OrderProvider wrapper)
│   │   │   ├── router/         # AppRouter barrel
│   │   │   ├── App.tsx         # AuthGate + OrderProvider + AppRouter shell
│   │   │   └── router.tsx      # Customer Store & 12-Module Admin routes
│   │   ├── components/
│   │   │   ├── common/         # AuthGate, EmailSignIn, MobileNumberInput, Notice, OrderStepper, ProfileModal
│   │   │   └── layout/         # StoreLayout, AdminLayout, Header, Footer
│   │   ├── constants/          # Store & product constants
│   │   ├── context/
│   │   │   └── OrderContext.tsx# Account-scoped checkout state & draft persistence
│   │   ├── features/
│   │   │   ├── catalog/        # HomePage, NotFoundPage, catalogApi
│   │   │   ├── orders/         # OrderForm, ReviewOrder, OrderConfirmation, MyOrders, OrderTracking
│   │   │   ├── payments/       # QRPayment, PaymentVerification, PaymentFlow, paymentsApi
│   │   │   ├── reviews/        # CustomerReviewsPage (English & Gujarati validation)
│   │   │   ├── store/          # VisitStorePage
│   │   │   ├── help/           # HelpFAQsPage
│   │   │   └── admin/          # 12-Module Owner Admin Management Panel
│   │   │       ├── api/        # Typed FastAPI client for all 24 admin endpoints
│   │   │       ├── components/ # AdminHeader, AdminSidebar, AdminRouteGuard, Badges, Drawers, Modals
│   │   │       ├── lib/        # Deterministic state machines & reference preview data
│   │   │       ├── pages/      # All 12 Admin Module pages (/admin/dashboard .. /admin/settings)
│   │   │       ├── styles/     # Responsive admin dashboard CSS
│   │   │       └── types/      # Admin TypeScript contracts
│   │   ├── hooks/              # Shared React hooks (useSession)
│   │   ├── lib/
│   │   │   ├── api/            # API client & contracts barrel
│   │   │   ├── auth/           # Auth & customer validation barrel
│   │   │   ├── supabase/       # Supabase client barrel
│   │   │   ├── api.ts          # Centralized fetch wrapper, timeout, bearer token & INR formatter
│   │   │   ├── contracts.ts    # Runtime server response validators
│   │   │   ├── customer.ts     # Indian mobile (+91) normalization & validation
│   │   │   ├── env.ts          # Centralized environment variable reader
│   │   │   └── supabase.ts     # Supabase client & Simple DB Check Login/Auto-Signup
│   │   ├── services/           # Unified API services barrel
│   │   ├── styles/
│   │   │   └── globals.css     # Core Balaji Faki Point design system
│   │   ├── types/
│   │   │   └── orders.ts       # Customer order & payment TypeScript unions
│   │   └── utils/              # Currency & mobile formatters
│   ├── tests/                  # Automated test suites (checkout, secondary-pages, auth, admin)
│   ├── .env.example
│   ├── index.html
│   ├── package.json
│   ├── tsconfig.json
│   ├── vercel.json
│   └── vite.config.ts
├── scripts/
│   └── verify-all.mjs          # End-to-end verification script (typecheck + tests + build + structure)
├── supabase/
│   ├── config.toml             # Local Supabase configuration
│   └── migrations/             # 3 applied PostgreSQL schema, RLS & DB-login migrations
├── .env.example                # Public frontend & server environment variable template
├── .gitignore
├── package.json                # Root workspace runner delegating to frontend/
└── vercel.json
```

---

## 3. Local Setup & Startup Commands

All commands work from either the **repository root** (`d:\D&D Projects\Balaji Faki Website`) or inside `frontend/`:

```powershell
# 1. Install dependencies
npm install

# 2. Start local development server (Customer Store + /admin/* Panel)
npm run dev

# 3. Run TypeScript validation
npm run typecheck

# 4. Run all 4 automated test suites
npm test

# 5. Build production bundle (outputs to frontend/dist/)
npm run build

# 6. Run complete verification suite (typecheck + tests + build + path checks)
npm run verify
```

---

## 3a. Full local stack (React + FastAPI + local Supabase)

Everything runs on this machine. **Never** run `supabase link`, `db push`, `--linked` or any command against the online project;
`npm run verify` includes `scripts/check-local-only.mjs`, which fails if any active config could reach it.

```powershell
# 0. Docker Desktop (Linux engine) must be running.
supabase start                         # local Postgres 54322, Auth/API 54321, Storage; prints local keys (do not paste them anywhere public)
supabase db reset                      # LOCAL database only: applies supabase/migrations in order
# Put the local keys from `supabase status` into backend/.env and frontend/.env (they are gitignored).
python -m pip install -r backend/requirements.txt
python scripts/check-db-security.py    # private-data vs public-access assertions on the local database (rolled back)
cd backend; python -m app.db.seed --dev --dev-admin   # explicit DEVELOPMENT data + a local Owner Admin (credentials -> .local-dev-credentials.json, gitignored)
cd backend; python -m uvicorn app.main:app --port 8000
npm run dev                            # http://localhost:5173
```

Rules the code enforces:

- Request handlers never create prices, stock, products or settings. Only `python -m app.db.seed --dev` does, and it never overwrites
  existing rows. Only **Faki 1 kg = Rs 1,000** is an owner-confirmed price; every other seeded price is a development price shown with a badge.
- `BFP_ENV=local` (set in `backend/.env`) enables development-only conveniences (TEST bank-credit evidence, a per-process signing key).
  Any other value fails closed, and checkout stays closed until the owner confirms prices and payment settings in Admin → Settings.
- Payment settings seeded for development are LOCAL TEST values, not a real receiving account.
- Admin access needs a successful `GET /api/me` with `OWNER_ADMIN`; the browser never decides.

Tests: `npm run typecheck`, `npm test`, `python -m unittest discover -s backend/tests`, `node scripts/check-local-only.mjs`.
The backend suite runs on SQLite; **PostgreSQL, RLS, Auth and Storage behaviour is only proven by running `scripts/check-db-security.py` and the
smoke checks against the local Supabase stack** (see `docs/CLAUDE_CHANGE_PLAN.md` for what has and has not been verified).

---

## 4. Environment Configuration

Keep your existing `.env` / `frontend/.env` or copy `.env.example` to `.env`:

```ini
VITE_API_BASE_URL=http://127.0.0.1:8000/api
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_PUBLISHABLE_KEY=
VITE_SUPABASE_ANON_KEY=
VITE_SUPPORT_WHATSAPP=918000961030
```

- When `VITE_API_BASE_URL` is empty, live FastAPI checkout/admin mutations are safely disabled and display explicit integration-pending notices.
- In development with FastAPI running locally, set `VITE_API_BASE_URL=http://localhost:8000/api`.
- Never expose `SUPABASE_SECRET_KEY` or `DATABASE_URL` in `VITE_*` variables.

---

## 5. Documentation Index

- [System Architecture](docs/architecture/system-architecture.md)
- [API Contracts (Customer & Admin)](docs/api/api-contracts.md)
- [Database Schema & Migrations](docs/database/schema-and-migrations.md)
- [Vercel & Supabase Deployment Guide](docs/deployment/vercel-and-supabase.md)
- [Testing & Validation Guide](docs/testing/test-plan-and-results.md)
- [UI Design Reference Map](docs/design-reference/README.md)
- [Design QA Report](docs/testing/design-qa.md)
