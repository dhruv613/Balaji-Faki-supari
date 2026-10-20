# Balaji Faki Point — Backend (FastAPI)

The API for the storefront and the Admin Panel, deployed on Vercel through `../api/index.py` and running on Neon.

- `app/main.py`: all routes (`/api/*`; admin routes under `/api/admin/*`).
- `app/core/security.py`: Neon Auth JWT verification (EdDSA via JWKS); roles come only from `public.user_profiles`.
- `app/core/storage.py`: Neon Object Storage (private `assets` bucket) and short-lived signed links.
- `app/core/config.py`, `app/db/session.py`: settings and the database engine (pooled Neon connection, no app-side pool).
- `app/db/models.py`, `app/db/seed.py`: SQLAlchemy models and the local SQLite development seed.
- `migrations/neon/`: the PostgreSQL schema, applied with `../scripts/setup-neon-db.py`.
- `tests/`: `python -m unittest discover -s tests` (SQLite, no network).

Run locally: `python -m uvicorn app.main:app --app-dir backend --port 8000` from the repo root, with a Neon branch's variables in the environment. See [../docs/NEON_SETUP.md](../docs/NEON_SETUP.md) and [../.env.example](../.env.example).
