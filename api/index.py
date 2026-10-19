"""Vercel entrypoint: serves the FastAPI app that lives in backend/app (every /api/* request is rewritten here by vercel.json)."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from app.main import app  # noqa: E402,F401  (Vercel serves the ASGI object named `app`)
