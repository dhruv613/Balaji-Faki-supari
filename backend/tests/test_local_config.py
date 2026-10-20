"""Environment precedence and fail-closed Neon Auth configuration."""

from __future__ import annotations

import os
import sys
import unittest
import runpy
import tempfile
from pathlib import Path
from unittest.mock import patch


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

# Keep this configuration-only test independent from a running local PostgreSQL service.
os.environ["DATABASE_URL"] = "sqlite:///:memory:"

from app.core.config import LOCAL_CORS_ORIGINS, Settings  # noqa: E402


class LocalConfigTests(unittest.TestCase):
    def test_neon_root_environment_takes_precedence_over_old_backend_settings(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            module = root / "backend/app/core/config.py"
            module.parent.mkdir(parents=True)
            module.write_text((BACKEND_ROOT / "app/core/config.py").read_text(encoding="utf-8"), encoding="utf-8")
            (root / "backend/.env").write_text("DATABASE_URL=old-backend\nBFP_ENV=local\n", encoding="utf-8")
            (root / ".env").write_text("DATABASE_URL=neon-root\n", encoding="utf-8")
            with patch.dict(os.environ, {}, clear=True):
                configured = runpy.run_path(str(module))["settings"]
                self.assertEqual(configured.database_url, "neon-root")
                self.assertEqual(configured.app_env, "local")
            (root / ".env.local").write_text("DATABASE_URL=neon-local\n", encoding="utf-8")
            with patch.dict(os.environ, {}, clear=True):
                self.assertEqual(runpy.run_path(str(module))["settings"].database_url, "neon-local")
            with patch.dict(os.environ, {"DATABASE_URL": "process-value"}, clear=True):
                self.assertEqual(runpy.run_path(str(module))["settings"].database_url, "process-value")

    def test_database_url_accepts_vercel_integration_and_prefers_explicit_setting(self) -> None:
        postgres_url = "postgresql://postgres.example:password@pooler.example:6543/postgres"
        for database_url in ("", "   ", "sqlite:///:memory:"):
            with self.subTest(database_url=database_url), patch.dict(
                os.environ, {"DATABASE_URL": database_url, "POSTGRES_URL": postgres_url}
            ):
                self.assertEqual(Settings().database_url, database_url.strip() or postgres_url)

    def test_blank_auth_environment_stays_unconfigured(self) -> None:
        with patch.dict(os.environ, {"NEON_AUTH_BASE_URL": "", "VITE_NEON_AUTH_URL": "", "NEON_AUTH_JWKS_URL": "", "CORS_ORIGINS": ""}):
            configured = Settings()
        self.assertEqual(configured.neon_auth_base_url, "")
        self.assertEqual(configured.neon_auth_jwks_url, "")
        self.assertEqual(configured.cors_origins, tuple(LOCAL_CORS_ORIGINS.split(",")))

    def test_auth_jwks_uses_the_full_branch_path(self) -> None:
        with patch.dict(os.environ, {"NEON_AUTH_BASE_URL": "https://auth.neon.example/neondb/auth/", "NEON_AUTH_JWKS_URL": ""}):
            self.assertEqual(Settings().neon_auth_jwks_url, "https://auth.neon.example/neondb/auth/.well-known/jwks.json")


if __name__ == "__main__":
    unittest.main()
