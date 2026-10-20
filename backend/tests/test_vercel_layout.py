"""The repo deploys to Vercel as-is: static frontend plus the FastAPI app served by api/index.py."""

from __future__ import annotations

import asyncio
import importlib.util
import json
import os
import sys
import unittest
from dataclasses import replace
from pathlib import Path
from unittest.mock import patch

BACKEND_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_ROOT.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

os.environ["DATABASE_URL"] = "sqlite:///:memory:"


def _pins(path: Path) -> list[str]:
    return [line.strip() for line in path.read_text(encoding="utf-8").splitlines() if line.strip() and not line.startswith("#")]


class VercelLayoutTests(unittest.TestCase):
    def test_root_and_backend_dependency_pins_and_python_version_stay_in_sync(self) -> None:
        self.assertEqual(_pins(REPO_ROOT / "requirements.txt"), _pins(BACKEND_ROOT / "requirements.txt"))
        self.assertTrue(all("==" in pin for pin in _pins(BACKEND_ROOT / "requirements.txt")), "every dependency is pinned")
        self.assertEqual((REPO_ROOT / ".python-version").read_text().strip(), (BACKEND_ROOT / ".python-version").read_text().strip())

    def test_vercel_json_routes_api_to_the_function_before_the_spa_fallback(self) -> None:
        config = json.loads((REPO_ROOT / "vercel.json").read_text(encoding="utf-8"))
        self.assertIsNone(config["framework"])  # explicit "Other": no auto-detected preset takes over the project
        # Like D&D: the store builds itself (no root package.json) and Vercel serves frontend/dist.
        self.assertEqual(config["outputDirectory"], "frontend/dist")
        self.assertIn("npm --prefix frontend ci", config["buildCommand"])
        self.assertFalse((REPO_ROOT / "package.json").exists(), "no root npm workspace")
        admin = json.loads((REPO_ROOT / "admin-panel" / "vercel.json").read_text(encoding="utf-8"))
        self.assertEqual((admin["installCommand"], admin["outputDirectory"]), ("npm ci", "dist"))
        self.assertTrue((REPO_ROOT / "admin-panel" / "package-lock.json").is_file(), "npm ci needs the admin lockfile")
        self.assertEqual(
            [(r["source"], r["destination"]) for r in config["rewrites"]],
            [("/api/(.*)", "/api/index"), ("/(.*)", "/index.html")],
        )
        self.assertIn("api/index.py", config["functions"])
        self.assertTrue((REPO_ROOT / "api" / "index.py").is_file())

    def test_api_entrypoint_binds_app_at_top_level(self) -> None:
        # Vercel detects Python functions statically; `app` bound only inside try/except fails the build.
        source = (REPO_ROOT / "api" / "index.py").read_text(encoding="utf-8")
        self.assertRegex(source, r"(?m)^app = ")

    def test_api_entrypoint_exposes_the_backend_app(self) -> None:
        spec = importlib.util.spec_from_file_location("vercel_api_index", REPO_ROOT / "api" / "index.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        from app.main import app

        self.assertIs(module.app, app)

    def _entrypoint(self):
        spec = importlib.util.spec_from_file_location("vercel_api_index", REPO_ROOT / "api" / "index.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    @staticmethod
    def _call(app, path: str = "/api/health") -> tuple[int, dict]:
        sent: list[dict] = []

        async def receive():
            return {"type": "http.request", "body": b""}

        async def send(message):
            sent.append(message)

        asyncio.run(app({"type": "http", "path": path, "method": "GET", "headers": []}, receive, send))
        return sent[0]["status"], json.loads(sent[1]["body"])

    def test_a_backend_that_cannot_start_answers_503_with_the_reason(self) -> None:
        entry = self._entrypoint()
        status, body = self._call(entry._startup_error_app(RuntimeError("DATABASE_URL is not set.")))
        self.assertEqual(status, 503)
        self.assertIn("DATABASE_URL is not set", body["detail"])  # our own configuration errors are shown
        _, other = self._call(entry._startup_error_app(ValueError("postgresql://user:secret@host/db")))
        self.assertNotIn("secret", other["detail"])  # unexpected errors are named by type only, never echoed

    def test_health_names_the_missing_settings_outside_local_development(self) -> None:
        import app.routes.public as public_module
        bare = replace(public_module.settings, app_env="production", neon_auth_base_url="", neon_auth_jwks_url="", proof_signing_secret="")
        with patch.object(public_module, "settings", bare), patch.dict(os.environ, {key: "" for key in ("AWS_ENDPOINT_URL_S3", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_REGION")}):
            response = public_module.get_health()
            self.assertEqual(response.status_code, 503)
            missing = json.loads(response.body)["missingConfig"]
            self.assertEqual(len(missing), 7)
            self.assertTrue(all("=" not in name for name in missing), "names only, never values")
            with patch.object(public_module, "settings", replace(bare, app_env="local")):
                self.assertEqual(public_module.get_health()["status"], "ok")


if __name__ == "__main__":
    unittest.main()
