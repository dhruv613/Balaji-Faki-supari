"""Regression checks for local-only Supabase defaults."""

from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

# Keep this configuration-only test independent from a running local PostgreSQL service.
os.environ["DATABASE_URL"] = "sqlite:///:memory:"

from app.core.config import LOCAL_CORS_ORIGINS, LOCAL_SUPABASE_URL, Settings  # noqa: E402


class LocalConfigTests(unittest.TestCase):
    def test_blank_supabase_environment_uses_local_urls_only(self) -> None:
        with patch.dict(
            os.environ,
            {
                "SUPABASE_URL": "",
                "VITE_SUPABASE_URL": "",
                "SUPABASE_JWKS_URL": "",
                "CORS_ORIGINS": "",
            },
        ):
            settings = Settings()

        self.assertEqual(settings.supabase_url, LOCAL_SUPABASE_URL)
        self.assertEqual(
            settings.supabase_jwks_url,
            f"{LOCAL_SUPABASE_URL}/auth/v1/.well-known/jwks.json",
        )
        self.assertEqual(settings.cors_origins, tuple(LOCAL_CORS_ORIGINS.split(",")))
        self.assertNotIn("https://", settings.supabase_url)


if __name__ == "__main__":
    unittest.main()
