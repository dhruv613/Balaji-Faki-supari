"""The Admin Panel's single fixed login: ADMIN_EMAIL / ADMIN_PASSWORD on the server, no Neon Auth involved."""

from __future__ import annotations

import os
import sys
import tempfile
import time
import unittest
from dataclasses import replace
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

TMP = Path(tempfile.mkdtemp(prefix="bfp_admin_login_test_"))
DB_URL = f"sqlite:///{(TMP / 'admin_login.sqlite3').as_posix()}"
os.environ["DATABASE_URL"] = DB_URL
os.environ["BFP_ENV"] = "local"

from auth_support import mint_token, start_auth  # noqa: E402

import app.core.security as security  # noqa: E402
import app.db.session as db_session  # noqa: E402
import app.routes.admin as admin_routes  # noqa: E402
from app.db.models import UserProfile  # noqa: E402
from app.db.seed import seed_development_data  # noqa: E402
from app.main import app  # noqa: E402

ADMIN = replace(security.settings, admin_email="owner@balaji.example", admin_password="correct horse battery", proof_signing_secret="test-signing-secret")


class AdminLoginTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        start_auth(cls)
        db_session.configure_database(DB_URL)
        with db_session.SessionLocal() as db:
            seed_development_data(db)
        cls.client = TestClient(app)

    def setUp(self) -> None:
        admin_routes._admin_login_failures.clear()
        configured = patch.object(security, "settings", ADMIN)
        configured.start()
        self.addCleanup(configured.stop)

    def _login(self, email: str = "Owner@Balaji.example ", password: str = "correct horse battery"):
        return self.client.post("/api/admin/login", json={"email": email, "password": password})

    def test_right_email_and_password_open_the_admin_api(self) -> None:
        response = self._login()
        self.assertEqual(response.status_code, 200, response.text)
        headers = {"Authorization": f"Bearer {response.json()['token']}"}
        self.assertEqual(self.client.get("/api/admin/dashboard", headers=headers).status_code, 200)
        me = self.client.get("/api/me", headers=headers).json()
        self.assertEqual((me["role"], me["email"]), ("OWNER_ADMIN", "owner@balaji.example"))
        with db_session.SessionLocal() as db:  # one actor profile for audit logs, reused on the next login
            self.assertEqual(db.query(UserProfile).filter(UserProfile.email == "owner@balaji.example").count(), 1)
        self.assertEqual(self._login().status_code, 200)
        with db_session.SessionLocal() as db:
            self.assertEqual(db.query(UserProfile).filter(UserProfile.email == "owner@balaji.example").count(), 1)

    def test_wrong_details_are_refused_and_repeated_guessing_is_slowed(self) -> None:
        self.assertEqual(self._login(password="wrong password").status_code, 401)
        self.assertEqual(self._login(email="someone@else.example").status_code, 401)
        for _ in range(admin_routes.ADMIN_LOGIN_MAX_FAILURES):
            self._login(password="wrong password")
        self.assertEqual(self._login().status_code, 429)

    def test_forged_expired_or_old_password_tokens_are_rejected(self) -> None:
        token, _ = security.issue_admin_token(ADMIN)
        payload, signature = token[len(security.ADMIN_TOKEN_PREFIX):].split(".")
        forged = f"{security.ADMIN_TOKEN_PREFIX}{payload}.{'0' * len(signature)}"
        expired, _ = security.issue_admin_token(ADMIN, now=time.time() - security.ADMIN_SESSION_SECONDS - 1)
        for bad in (forged, expired):
            self.assertEqual(self.client.get("/api/admin/dashboard", headers={"Authorization": f"Bearer {bad}"}).status_code, 401)
        with patch.object(security, "settings", replace(ADMIN, admin_password="a brand new password")):
            self.assertEqual(self.client.get("/api/admin/dashboard", headers={"Authorization": f"Bearer {token}"}).status_code, 401)

    def test_not_configured_or_weak_password_means_no_admin_login(self) -> None:
        for settings in (replace(ADMIN, admin_email=""), replace(ADMIN, admin_password="short"), replace(ADMIN, proof_signing_secret="")):
            with patch.object(security, "settings", settings):
                self.assertEqual(self._login(password=settings.admin_password).status_code, 503)

    def test_customers_still_use_their_own_sign_in_and_cannot_reach_admin(self) -> None:
        customer = {"Authorization": f"Bearer {mint_token('55555555-5555-4555-8555-555555555555', 'shopper@example.com')}"}
        self.assertEqual(self.client.get("/api/me", headers=customer).json()["role"], "CUSTOMER")
        self.assertEqual(self.client.get("/api/admin/dashboard", headers=customer).status_code, 403)


if __name__ == "__main__":
    unittest.main()
