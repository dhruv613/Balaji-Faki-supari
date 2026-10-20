# Balaji Faki Point — Storefront

The customer website (React 19 + TypeScript + Vite). The Owner Admin Panel is a separate, self-contained app in [`../admin-panel`](../admin-panel).

- `src/features/`: catalog (home, product details), orders (form, review, confirmation, My Orders), payments (UPI QR and screenshot upload), reviews, store, help, account.
- `src/lib/auth.ts`: Neon Auth sign-in; `src/lib/api.ts`: API calls with the signed-in user's token; `src/lib/contracts.ts`: response validation.
- `src/components/common/EmailSignIn.tsx`: sign-in, account creation with an emailed code, and password reset.
- `tests/`: `npm test`.

Commands (inside `frontend/`): `npm install`, `npm run dev` (http://localhost:5173), `npm test`, `npm run build` (-> `frontend/dist`).

Commands and environment: see the [root README](../README.md) and [../.env.example](../.env.example).
