# Balaji Faki Point — Frontend Application

React 19 + TypeScript + Vite SPA for **Balaji Faki Point** (Customer Storefront & 12-Module Owner/Admin Management Panel).

## Directory Layout

```text
frontend/
├── public/
│   ├── favicon.svg
│   ├── icons/
│   ├── images/
│   └── logos/
├── src/
│   ├── app/
│   │   ├── providers/
│   │   ├── router/
│   │   ├── App.tsx
│   │   └── router.tsx
│   ├── components/
│   │   ├── common/
│   │   └── layout/
│   ├── constants/
│   ├── context/
│   ├── features/
│   │   ├── admin/          # 12 Admin modules, RBAC guard, state machine, typed API
│   │   ├── catalog/        # Home & catalog API
│   │   ├── help/           # Help & FAQs
│   │   ├── orders/         # Order Form, Review Order, Confirmation, My Orders, Tracking
│   │   ├── payments/       # Payment Flow, QR Payment, Payment Verification
│   │   ├── reviews/        # Customer Reviews
│   │   └── store/          # Visit Store
│   ├── hooks/
│   ├── lib/
│   │   ├── api/
│   │   ├── auth/
│   │   └── supabase/
│   ├── services/
│   ├── styles/
│   ├── types/
│   ├── utils/
│   └── main.tsx
├── tests/
│   ├── auth.test.mjs
│   ├── checkout.test.mjs
│   ├── secondary-pages.test.mjs
│   └── admin.test.mjs
├── .env.example
├── index.html
├── package.json
├── tsconfig.json
├── vercel.json
└── vite.config.ts
```

## Commands

Run from either the repository root or `frontend/`:

```powershell
npm run dev        # Start local Vite dev server at http://localhost:5173
npm run typecheck  # Run TypeScript strict validation
npm test           # Run all 4 isolated test suites
npm run build      # Build production bundle into frontend/dist
npm run preview    # Preview production bundle locally
```
