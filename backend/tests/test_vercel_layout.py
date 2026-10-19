"""The repo deploys to Vercel as-is: static frontend plus the FastAPI app served by api/index.py."""

from __future__ import annotations

import importlib.util
import json
import os
import sys
import unittest
from pathlib import Path

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
        self.assertEqual(config["outputDirectory"], "dist")
        self.assertEqual(
            [(r["source"], r["destination"]) for r in config["rewrites"]],
            [("/api/(.*)", "/api/index"), ("/(.*)", "/index.html")],
        )
        self.assertIn("api/index.py", config["functions"])
        self.assertTrue((REPO_ROOT / "api" / "index.py").is_file())

    def test_api_entrypoint_exposes_the_backend_app(self) -> None:
        spec = importlib.util.spec_from_file_location("vercel_api_index", REPO_ROOT / "api" / "index.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        from app.main import app

        self.assertIs(module.app, app)


if __name__ == "__main__":
    unittest.main()
