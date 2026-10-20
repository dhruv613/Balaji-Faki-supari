# Balaji Faki Point — Storefront

The customer website (React 19 + TypeScript + Vite). The Owner Admin Panel is a separate app in [`../admin-panel/frontend`](../admin-panel/frontend) that reuses this folder's shared code.

- `src/features/`: catalog (home, product details), orders (form, review, confirmation, My Orders), payments (UPI QR and screenshot upload), reviews, store, help, account.
- `src/lib/auth.ts`: Neon Auth sign-in; `src/lib/api.ts`: API calls with the signed-in user's token; `src/lib/contracts.ts`: response validation.
- `src/components/common/EmailSignIn.tsx`: sign-in, account creation with an emailed code, and password reset.
- `tests/`: `npm test` from the repo root.

Commands and environment: see the [root README](../README.md) and [../.env.example](../.env.example).
