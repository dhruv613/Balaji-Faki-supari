"""Vercel entrypoint: serves the FastAPI app that lives in backend/app (every /api/* request is rewritten here by vercel.json).

If the backend cannot start (usually a missing environment variable), Vercel would only show a generic
FUNCTION_INVOCATION_FAILED. This answers 503 with the reason instead, and prints the traceback to the function logs.
"""

import json
import sys
import traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))


def _startup_error_app(exc: Exception):
    # Configuration errors raised by our own code (RuntimeError) are safe to show; anything else only by type.
    reason = str(exc) if type(exc) is RuntimeError else f"{type(exc).__name__} (see the function logs)"
    body = json.dumps({"detail": f"The API could not start: {reason}"}).encode()

    async def app(scope, receive, send):
        if scope["type"] != "http":
            return
        await send({"type": "http.response.start", "status": 503, "headers": [(b"content-type", b"application/json")]})
        await send({"type": "http.response.body", "body": body})

    return app


try:
    from app.main import app  # Vercel serves the ASGI object named `app`
except Exception as exc:  # noqa: BLE001
    traceback.print_exc()
    app = _startup_error_app(exc)
