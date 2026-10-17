# Balaji Faki Point — Backend Service

## Current Backend Inspection Status

- **Existing Files in `backend/`**:
  - `package.json` & `package-lock.json`: Contains `@supabase/server` (`^1.9.2`) installed for Supabase server-side credential verification. No Node.js server entrypoint (`index.js`) exists yet.
  - `.env` & `.env.example`: Server-side Supabase environment variables (`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `SUPABASE_JWKS_URL`, `DATABASE_URL`).
  - `New Microsoft Excel Worksheet.xlsx`: Preserved user spreadsheet file.
- **Target Backend Stack**:
  - **Python 3.11+ / FastAPI**
  - **SQLAlchemy 2.0** (ORM mapped to the 18 PostgreSQL tables in `supabase/migrations/`)
  - **Pydantic v2** (Strict request/response validation using integer `paise` for monetary calculations)
  - **Alembic** (Database migration management alongside Supabase CLI)

## Target FastAPI Directory Layout

When implementing the FastAPI service inside `backend/`, use this structure:

```text
backend/
├── app/
│   ├── main.py
│   ├── core/
│   │   ├── config.py
│   │   └── security.py
│   ├── db/
│   │   ├── base.py
│   │   └── session.py
│   ├── models/
│   ├── schemas/
│   ├── repositories/
│   ├── services/
│   ├── integrations/
│   │   ├── supabase/
│   │   └── email/
│   └── api/
│       └── v1/
│           ├── auth.py
│           ├── products.py
│           ├── orders.py
│           ├── payments.py
│           ├── tracking.py
│           ├── reviews.py
│           └── admin/
│               ├── dashboard.py
│               ├── orders.py
│               ├── payments.py
│               ├── products.py
│               ├── inventory.py
│               ├── delivery.py
│               ├── customers.py
│               ├── reviews.py
│               ├── refunds.py
│               ├── reports.py
│               └── settings.py
├── alembic/
├── tests/
├── requirements.txt
├── .env.example
└── README.md
```

See [`../docs/api/api-contracts.md`](../docs/api/api-contracts.md) and [`../docs/database/schema-and-migrations.md`](../docs/database/schema-and-migrations.md) for the complete endpoint and database specifications.
