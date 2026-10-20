"""Neon JWT signatures, strict claims, and database-only application permissions."""
from __future__ import annotations
import base64
import json
import sys
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import jwt
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.core.security import AuthError, extract_bearer_token, enforce_owner_admin, resolve_authenticated_principal, validate_jwt_claims, verify_access_token
from auth_support import KEY, ISSUER, SETTINGS, mint_token


class SecurityTests(unittest.TestCase):
    def setUp(self):
        self.subject = "97cb5e49-677c-460c-92f0-9e380d73c2be"
        self.valid_claims = {"sub": self.subject, "aud": ISSUER, "iss": ISSUER,
                             "iat": int(time.time()), "exp": int(time.time()) + 900}
        client = SimpleNamespace(get_jwk_set=lambda refresh=False: SimpleNamespace(keys=[SimpleNamespace(key_id="test-key", key=KEY.public_key())]))
        stub = patch("app.core.security._jwk_client", return_value=client)
        stub.start()
        self.addCleanup(stub.stop)

    def test_real_signature_and_tampering(self):
        token = jwt.encode(self.valid_claims, KEY, algorithm="EdDSA", headers={"kid": "test-key"})
        self.assertEqual(verify_access_token(token, app_settings=SETTINGS)["sub"], self.subject)
        wrong = jwt.encode(self.valid_claims, Ed25519PrivateKey.generate(), algorithm="EdDSA", headers={"kid": "test-key"})
        with self.assertRaises(AuthError):
            verify_access_token(wrong, app_settings=SETTINGS)
        header, _, signature = token.split(".")
        payload = base64.urlsafe_b64encode(json.dumps({**self.valid_claims, "sub": "forged"}).encode()).decode().rstrip("=")
        with self.assertRaises(AuthError):
            verify_access_token(f"{header}.{payload}.{signature}", app_settings=SETTINGS)

    def test_unknown_key_id_refetches_the_key_set_at_most_once_a_minute(self):
        from app.core import security
        fetches = []
        client = SimpleNamespace(get_jwk_set=lambda refresh=False: fetches.append(refresh) or SimpleNamespace(keys=[]))
        security._JWKS_REFETCHED_AT.clear()
        with patch("app.core.security._jwk_client", return_value=client):
            for _ in range(5):
                forged = jwt.encode(self.valid_claims, KEY, algorithm="EdDSA", headers={"kid": f"random-{_}"})
                with self.assertRaises(AuthError):
                    verify_access_token(forged, app_settings=SETTINGS)
        self.assertEqual(fetches.count(True), 1, "only one network refetch for a burst of unknown key ids")
        no_kid = jwt.encode(self.valid_claims, KEY, algorithm="EdDSA")
        with self.assertRaises(AuthError):
            verify_access_token(no_kid, app_settings=SETTINGS)

    def test_small_clock_skew_is_tolerated(self):
        ahead = {**self.valid_claims, "iat": int(time.time()) + 20}
        token = jwt.encode(ahead, KEY, algorithm="EdDSA", headers={"kid": "test-key"})
        self.assertEqual(verify_access_token(token, app_settings=SETTINGS)["sub"], self.subject)

    def test_rejects_wrong_algorithm_and_missing_or_wrong_claims(self):
        wrong_alg = jwt.encode(self.valid_claims, "test-secret-32-characters-long-required", algorithm="HS256")
        with self.assertRaises(AuthError):
            verify_access_token(wrong_alg, app_settings=SETTINGS)
        for field in ("sub", "iat", "exp", "aud", "iss"):
            claims = {key: value for key, value in self.valid_claims.items() if key != field}
            with self.subTest(field=field), self.assertRaises(AuthError):
                verify_access_token(jwt.encode(claims, KEY, algorithm="EdDSA", headers={"kid": "test-key"}), app_settings=SETTINGS)
        for field, value in (("exp", 0), ("iat", int(time.time()) + 1000), ("aud", "another-app"), ("iss", ISSUER + "/wrong"), ("sub", "")):
            with self.subTest(field=field), self.assertRaises(AuthError):
                verify_access_token(jwt.encode({**self.valid_claims, field: value}, KEY, algorithm="EdDSA", headers={"kid": "test-key"}), app_settings=SETTINGS)

    def test_principal_uses_canonical_profile_id_and_database_permissions(self):
        profile = {"id": "historical-profile-id", "auth_subject": self.subject, "email": "owner@example.com", "role": "CUSTOMER", "is_active": True}
        claims = {**self.valid_claims, "role": "OWNER_ADMIN", "user_metadata": {"role": "OWNER_ADMIN"}}
        principal = resolve_authenticated_principal(claims, profile)
        self.assertEqual(principal.id, "historical-profile-id")
        self.assertEqual(principal.role, "CUSTOMER")
        with self.assertRaises(AuthError):
            enforce_owner_admin(principal)
        self.assertEqual(enforce_owner_admin(resolve_authenticated_principal(claims, {**profile, "role": "OWNER_ADMIN"})).role, "OWNER_ADMIN")
        for bad in (None, {**profile, "auth_subject": "another-user"}, {**profile, "is_active": False}):
            with self.assertRaises(AuthError):
                resolve_authenticated_principal(claims, bad)

    def test_rejects_synthetic_tokens(self):
        for header in (None, "Bearer bfp-session-fake", "Bearer not-a-jwt", "Basic credentials"):
            with self.assertRaises(AuthError):
                extract_bearer_token(header)

    def test_signed_proof_url_verification_tampering_and_expiry(self) -> None:
        from app.core.storage import create_signed_proof_query, verify_signed_proof_query

        payment_id = "test-pay-12345"
        storage_path = "user-1/order-1/proof.png"
        now = int(time.time())

        sig, exp = create_signed_proof_query(payment_id, storage_path, ttl_seconds=300, now_epoch=now)
        self.assertTrue(verify_signed_proof_query(payment_id, storage_path, sig=sig, exp=exp, now_epoch=now))

        # Tampered signature must fail
        self.assertFalse(verify_signed_proof_query(payment_id, storage_path, sig="forged-sig", exp=exp, now_epoch=now))

        # Mismatched payment ID or path must fail
        self.assertFalse(verify_signed_proof_query("different-pay-id", storage_path, sig=sig, exp=exp, now_epoch=now))
        self.assertFalse(verify_signed_proof_query(payment_id, "user-2/order-2/proof.png", sig=sig, exp=exp, now_epoch=now))

        # Expired signature must fail
        self.assertFalse(verify_signed_proof_query(payment_id, storage_path, sig=sig, exp=exp, now_epoch=now + 301))

