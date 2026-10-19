# Deployment Guide — Vercel & Supabase

> **Historical document (written before the local-only phase).** It describes the previous online/staging setup, including the retired
> database-password login and commands that target the online Supabase project. Do **not** run any command from it.
> Current instructions: README section 3a and `docs/CLAUDE_CHANGE_PLAN.md`.


## 1. Frontend Deployment on Vercel

- **Root Directory**: `./` (workspace root)
- **Framework Preset**: `Vite`
- **Build Command**: `npm run build`
- **Output Directory**: `dist`
- **SPA Routing**: Configured in [`vercel.json`](../../vercel.json):
  ```json
  {
    "rewrites": [
      { "source": "/(.*)", "destination": "/index.html" }
    ]
  }
  ```

### Required Vercel Frontend Environment Variables

| Variable | Value / Description | Exposure |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | `https://zyzkoolgwbczvvetjnwf.supabase.co` | Public (Browser) |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_...` | Public (Browser) |
| `VITE_SUPABASE_ANON_KEY` | Same as publishable key (for backwards compatibility) | Public (Browser) |
| `VITE_API_BASE_URL` | Production FastAPI base URL (e.g., `https://api.balajifakipoint.com/api`) | Public (Browser) |
| `VITE_SUPPORT_WHATSAPP` | `918000961030` | Public (Browser) |

> **Security Rule**: Never add `SUPABASE_SECRET_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, or `DATABASE_URL` with a `VITE_` prefix.

---

## 2. Backend Deployment Considerations (FastAPI)

- **Database Connection Pooling**: When deploying FastAPI to serverless or containerized environments, connect SQLAlchemy using the **Supabase Transaction Pooler (port 6543)** with `prepare_threshold=None` / `statement_cache_size=0`.
- **Environment Variables for FastAPI**:
  - `SUPABASE_URL`
  - `SUPABASE_PUBLISHABLE_KEY`
  - `SUPABASE_SECRET_KEY` (Server-only secret key)
  - `SUPABASE_JWKS_URL`
  - `DATABASE_URL`
  - `CORS_ORIGINS` (Must match the Vercel frontend domain over HTTPS)

---

## 3. Pre-Deployment Checklist

- [x] `npm run typecheck` passes with `0` errors
- [x] `npm test` passes all 4 test suites (`checkout`, `secondary-pages`, `auth`, `admin`)
- [x] `npm run build` outputs clean production assets to `dist/`
- [x] All 18 PostgreSQL tables and RLS policies applied on Supabase (`zyzkoolgwbczvvetjnwf`)
- [x] `npx supabase db advisors --linked` reports `No issues found`
- [ ] FastAPI backend service implemented and deployed at `VITE_API_BASE_URL`
