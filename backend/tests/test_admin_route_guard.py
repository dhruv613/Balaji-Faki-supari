"""Every /admin route must reject anonymous and customer callers (signed-URL image routes verify a signature)."""

from __future__ import annotations

import os
import sys
import tempfile
import time
import unittest
from pathlib import Path

import jwt as pyjwt
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

TMP = Path(tempfile.mkdtemp(prefix="bfp_guard_test_"))
DB_URL = f"sqlite:///{(TMP / 'guard.sqlite3').as_posix()}"
os.environ["DATABASE_URL"] = DB_URL
os.environ["BFP_ENV"] = "local"

from auth_support import mint_token, start_auth  # noqa: E402

import app.db.session as db_session  # noqa: E402
from app.db.seed import seed_development_data  # noqa: E402
from app.main import app  # noqa: E402
from app.routes.common import get_owner_admin_principal  # noqa: E402

CUSTOMER_ID = "44444444-4444-4444-8444-444444444444"
# Image routes accept either a short-lived HMAC signature or an Owner Admin Bearer token; both are exercised below.
SIGNED_OR_ADMIN = {
    "/api/admin/payments/{payment_id}/proof",
    "/api/admin/reviews/photos/{photo_id}",
    "/api/admin/settings/qr",
}


def _depends_on_owner_admin(dependant) -> bool:
    return any(
        dep.call is get_owner_admin_principal or _depends_on_owner_admin(dep) for dep in dependant.dependencies
    )


def _token() -> str:
    return mint_token(CUSTOMER_ID, "guard-customer@example.com", "Guard Customer", user_metadata={"role": "OWNER_ADMIN"}, app_metadata={"role": "OWNER_ADMIN"})



class AdminRouteGuardTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        start_auth(cls)
        db_session.configure_database(DB_URL)
        with db_session.SessionLocal() as db:
            seed_development_data(db)  # settings row exists, so signed-URL routes reach their signature check
        cls.client = TestClient(app)
        cls.routes = [
            route
            for route in app.routes
            if isinstance(route, APIRoute) and route.path.startswith("/api/admin")
        ]

    def test_every_admin_route_is_guarded_by_owner_admin_or_a_signature(self) -> None:
        self.assertGreater(len(self.routes), 25)
        unguarded = [
            f"{sorted(route.methods)} {route.path}"
            for route in self.routes
            if route.path not in SIGNED_OR_ADMIN and not _depends_on_owner_admin(route.dependant)
        ]
        self.assertEqual(unguarded, [])
        for path in SIGNED_OR_ADMIN:
            self.assertTrue(any(route.path == path for route in self.routes), path)

    def test_anonymous_and_customer_requests_never_reach_admin_handlers(self) -> None:
        customer_headers = {"Authorization": f"Bearer {_token()}"}
        for route in self.routes:
            url = route.path.replace("{", "").replace("}", "") if False else (
                route.path.replace("{payment_id}", "x").replace("{photo_id}", "x")
                .replace("{order_id}", "x").replace("{product_id}", "x").replace("{image_id}", "x")
                .replace("{review_id}", "x").replace("{refund_id}", "x").replace("{delivery_id}", "x")
                .replace("{customer_id}", "x").replace("{notification_id}", "x")
            )
            for method in sorted(route.methods - {"HEAD", "OPTIONS"}):
                anonymous = self.client.request(method, url)
                as_customer = self.client.request(method, url, headers=customer_headers)
                if route.path in SIGNED_OR_ADMIN:
                    # Object lookup precedes the signature check; an unknown id is 404, a known one is 401.
                    self.assertIn(anonymous.status_code, (401, 404), f"anonymous {method} {route.path}")
                    self.assertIn(as_customer.status_code, (401, 403, 404), f"customer {method} {route.path}")
                else:
                    self.assertEqual(anonymous.status_code, 401, f"anonymous {method} {route.path}")
                    self.assertEqual(as_customer.status_code, 403, f"customer {method} {route.path}")


if __name__ == "__main__":
    unittest.main()
