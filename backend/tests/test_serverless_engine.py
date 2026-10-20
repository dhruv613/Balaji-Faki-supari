"""The database engine suits Vercel: pooled Supabase URLs get no app-side pool and no prepared statements."""

from __future__ import annotations

import os
import sys
import unittest
from dataclasses import replace
from pathlib import Path
from unittest.mock import patch

from sqlalchemy.pool import NullPool, QueuePool

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

os.environ["DATABASE_URL"] = "sqlite:///:memory:"

import app.db.session as session  # noqa: E402

POOLER = "postgresql+psycopg://postgres.abcdefgh:pw@aws-0-ap-south-1.pooler.supabase.com:6543/postgres"
DIRECT = "postgresql+psycopg://postgres:pw@db.abcdefgh.supabase.co:5432/postgres"


class ServerlessEngineTests(unittest.TestCase):
    def test_pooler_url_gets_no_app_pool_and_no_prepared_statements(self) -> None:
        engine = session.build_engine(POOLER)
        self.assertIsInstance(engine.pool, NullPool)
        with patch.object(session, "create_engine") as create:
            session.build_engine(POOLER)
        self.assertEqual(create.call_args.kwargs["connect_args"], {"prepare_threshold": None})

    def test_direct_url_keeps_a_normal_pool_unless_running_on_vercel(self) -> None:
        self.assertIsInstance(session.build_engine(DIRECT).pool, QueuePool)
        with patch.dict(os.environ, {"VERCEL": "1"}):
            self.assertIsInstance(session.build_engine(DIRECT).pool, NullPool)

    def test_missing_database_url_is_an_error_outside_local_development(self) -> None:
        with patch.object(session, "settings", replace(session.settings, database_url="", app_env="production")):
            with self.assertRaises(RuntimeError):
                session.resolve_database_url()
        with patch.object(session, "settings", replace(session.settings, database_url="", app_env="local")):
            self.assertTrue(session.resolve_database_url().startswith("sqlite:///"))

    def test_supabase_dialog_urls_use_psycopg3(self) -> None:
        for raw in ("postgres://u:pw@h:6543/postgres", "postgresql://u:pw@h:6543/postgres"):
            self.assertEqual(session.resolve_database_url(raw), "postgresql+psycopg://u:pw@h:6543/postgres")
        self.assertEqual(session.resolve_database_url(POOLER), POOLER)

    def test_sqlite_is_untouched(self) -> None:
        self.assertFalse(session.build_engine("sqlite:///:memory:").dialect.name == "postgresql")


if __name__ == "__main__":
    unittest.main()
