# Admin Panel backend

The Admin Panel has no separate server code. Its API is the shared FastAPI app in [`backend/`](../../backend): the
`/api/admin/*` endpoints in `backend/app/main.py` (orders, payments, prices, stock, delivery, refunds, reviews,
customers, settings), plus `/api/me` for the Owner Admin check. Store and admin share one database and one set of
order and payment rules, so a fix is made once and both sites get it.

How the admin site reaches it:

| Where | How |
|---|---|
| Vercel (`admin-panel` project) | `admin-panel/vercel.json` rewrites `/api/*` to the storefront's API, `https://balaji-faki-point.vercel.app/api/*`. The browser only talks to the admin domain, so no CORS setup is needed. Change that URL there if the storefront moves to a custom domain. |
| Local development | the same `VITE_API_BASE_URL` as the storefront (`frontend/.env`, `http://localhost:8000/api`); the backend allows `http://localhost:5174` by default. |

Access control lives in the API, not in the UI: every `/api/admin/*` request needs a Supabase session whose
`user_profiles.role` is `OWNER_ADMIN`.
