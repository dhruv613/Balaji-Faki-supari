"""Linking a Neon Auth identity to an application profile: only verified identities, never the owner by email,
historical customers keep their profile ID, and a profile linked to someone else cannot be taken over."""

from __future__ import annotations

import os
import sys
import tempfile
import unittest
import uuid
from pathlib import Path

from fastapi.testclient import TestClient

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

TMP = Path(tempfile.mkdtemp(prefix="bfp_linking_test_"))
DB_URL = f"sqlite:///{(TMP / 'linking.sqlite3').as_posix()}"
os.environ["DATABASE_URL"] = DB_URL
os.environ["BFP_ENV"] = "local"

from auth_support import IDENTITIES, mint_token, start_auth  # noqa: E402

import app.db.session as db_session  # noqa: E402
from app.db.models import UserProfile  # noqa: E402
from app.main import app  # noqa: E402


def subject() -> str:
    return str(uuid.uuid4())


class AccountLinkingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        start_auth(cls)
        db_session.configure_database(DB_URL)
        cls.client = TestClient(app)

    def me(self, token: str, method: str = "get", **kwargs):
        return getattr(self.client, method)("/api/me", headers={"Authorization": f"Bearer {token}"}, **kwargs)

    def add_profile(self, email: str, **fields) -> str:
        with db_session.SessionLocal() as db:
            profile = UserProfile(email=email, full_name=fields.pop("full_name", "Old Customer"), **fields)
            db.add(profile)
            db.commit()
            return profile.id

    def test_new_verified_identity_gets_a_customer_profile(self) -> None:
        sub = subject()
        first = self.me(mint_token(sub, "new-customer@example.test"))
        self.assertEqual(first.status_code, 200, first.text)
        self.assertEqual(first.json()["role"], "CUSTOMER")
        again = self.me(mint_token(sub, "new-customer@example.test"))
        self.assertEqual(again.json()["id"], first.json()["id"], "the same identity always maps to the same profile")

    def test_returning_customer_keeps_their_historical_profile_id(self) -> None:
        old_id = self.add_profile("returning@example.test")
        response = self.me(mint_token(subject(), "  Returning@Example.TEST "))
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["id"], old_id)

    def test_unverified_or_banned_identities_are_refused(self) -> None:
        unverified, banned = subject(), subject()
        unverified_token = mint_token(unverified, "unverified@example.test")
        IDENTITIES[unverified]["emailVerified"] = False
        self.assertEqual(self.me(unverified_token).status_code, 403)
        banned_token = mint_token(banned, "banned@example.test")
        IDENTITIES[banned]["banned"] = True
        self.assertEqual(self.me(banned_token).status_code, 403)

    def test_a_profile_linked_to_another_identity_cannot_be_taken_over(self) -> None:
        self.add_profile("taken@example.test", auth_subject=subject())
        response = self.me(mint_token(subject(), "taken@example.test"))
        self.assertEqual(response.status_code, 403)
        self.assertIn("different identity", response.json()["detail"])

    def test_the_owner_profile_is_never_linked_by_email(self) -> None:
        owner_id = self.add_profile("owner-link@example.test", role="OWNER_ADMIN", full_name="Owner")
        sub = subject()
        refused = self.me(mint_token(sub, "owner-link@example.test"))
        self.assertEqual(refused.status_code, 403, "whoever registers the owner's email first must not become Owner Admin")
        with db_session.SessionLocal() as db:
            self.assertIsNone(db.get(UserProfile, owner_id).auth_subject)
            db.get(UserProfile, owner_id).auth_subject = sub  # the operator links the verified owner once
            db.commit()
        linked = self.me(mint_token(sub, "owner-link@example.test"))
        self.assertEqual((linked.status_code, linked.json()["role"], linked.json()["id"]), (200, "OWNER_ADMIN", owner_id))

    def test_deactivated_historical_profiles_are_not_linked(self) -> None:
        self.add_profile("inactive@example.test", is_active=False)
        self.assertEqual(self.me(mint_token(subject(), "inactive@example.test")).status_code, 403)

    def test_profile_update_changes_only_name_and_phone(self) -> None:
        token = mint_token(subject(), "profile-edit@example.test")
        saved = self.me(token, "patch", json={"fullName": "  Kiran Patel  ", "phone": "+919876543210"})
        self.assertEqual(saved.status_code, 200, saved.text)
        self.assertEqual((saved.json()["fullName"], saved.json()["role"]), ("Kiran Patel", "CUSTOMER"))
        for forbidden in ({"role": "OWNER_ADMIN"}, {"email": "someone-else@example.test"}):
            with self.subTest(forbidden=forbidden):
                self.assertEqual(self.me(token, "patch", json={"fullName": "Kiran Patel", **forbidden}).status_code, 422)
        self.assertEqual(self.me(token).json()["role"], "CUSTOMER")


if __name__ == "__main__":
    unittest.main()
