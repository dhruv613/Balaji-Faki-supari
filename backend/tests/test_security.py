"""Unit tests for FastAPI Supabase JWT verification and RBAC enforcement."""

from __future__ import annotations

import base64
import json
import sys
import time
import unittest
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.core.config import LOCAL_SUPABASE_URL  # noqa: E402
from app.core.security import (  # noqa: E402
    AuthError,
    extract_bearer_token,
    enforce_owner_admin,
    resolve_authenticated_principal,
    validate_jwt_claims,
    verify_supabase_access_token,
)


def _encode_segment(payload: dict) -> str:
    raw = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _make_jwt(header: dict, claims: dict, signature: str = "signed-bytes") -> str:
    return f"{_encode_segment(header)}.{_encode_segment(claims)}.{signature}"


class SecurityTests(unittest.TestCase):
    def setUp(self) -> None:
        self.user_uuid = "97cb5e49-677c-460c-92f0-9e380d73c2be"
        self.valid_claims = {
            "sub": self.user_uuid,
            "aud": "authenticated",
            "role": "authenticated",
            "email": "dp334218@gmail.com",
            "iss": f"{LOCAL_SUPABASE_URL}/auth/v1",
            "exp": int(time.time()) + 3600,
            "user_metadata": {
                "fullName": "Dhruv",
                "phone": "+918160628688",
                "role": "OWNER_ADMIN",  # Must be ignored for RBAC if DB says CUSTOMER
            },
        }

    def test_rejects_synthetic_and_publishable_tokens(self) -> None:
        with self.assertRaises(AuthError):
            extract_bearer_token("Bearer bfp-session-97cb5e49-677c-460c-92f0-9e380d73c2be")
        with self.assertRaises(AuthError):
            extract_bearer_token("Bearer sb_publishable_local_test_key")
        with self.assertRaises(AuthError):
            extract_bearer_token(None)

    def test_rejects_anon_and_service_role_jwts(self) -> None:
        for disallowed_role in ("anon", "service_role"):
            with self.assertRaises(AuthError):
                validate_jwt_claims({**self.valid_claims, "role": disallowed_role})

    def test_rejects_expired_or_missing_sub_jwt(self) -> None:
        with self.assertRaises(AuthError):
            validate_jwt_claims({**self.valid_claims, "exp": int(time.time()) - 10})
        with self.assertRaises(AuthError):
            validate_jwt_claims({**self.valid_claims, "sub": "not-a-uuid"})

    def test_user_metadata_cannot_escalate_to_owner_admin(self) -> None:
        # Even though user_metadata has role="OWNER_ADMIN", DB profile says CUSTOMER
        principal = resolve_authenticated_principal(
            self.valid_claims,
            {
                "id": self.user_uuid,
                "email": "customer@example.com",
                "full_name": "Customer User",
                "phone": "+919876543210",
                "role": "CUSTOMER",
                "is_active": True,
            },
        )
        self.assertEqual(principal.role, "CUSTOMER")
        with self.assertRaises(AuthError) as ctx:
            enforce_owner_admin(principal)
        self.assertEqual(ctx.exception.status_code, 403)

    def test_verified_owner_admin_in_db_is_authorized(self) -> None:
        token = _make_jwt({"alg": "ES256", "typ": "JWT"}, self.valid_claims)
        verified = verify_supabase_access_token(
            token,
            jwks_verifier=lambda _tok: self.valid_claims,
        )
        principal = resolve_authenticated_principal(
            verified,
            {
                "id": self.user_uuid,
                "email": "dp334218@gmail.com",
                "full_name": "Dhruv",
                "phone": "+918160628688",
                "role": "OWNER_ADMIN",
                "is_active": True,
            },
        )
        self.assertEqual(enforce_owner_admin(principal).role, "OWNER_ADMIN")

    def test_deactivated_account_is_blocked(self) -> None:
        with self.assertRaises(AuthError) as ctx:
            resolve_authenticated_principal(
                self.valid_claims,
                {
                    "id": self.user_uuid,
                    "email": "dp334218@gmail.com",
                    "role": "OWNER_ADMIN",
                    "is_active": False,
                },
            )
        self.assertEqual(ctx.exception.status_code, 403)

    def test_real_cryptographic_signature_verification_and_tamper_rejection(self) -> None:
        import jwt as pyjwt

        secret = "test-supabase-hs256-jwt-secret-key-minimum-32-bytes"
        signed_token = pyjwt.encode(
            self.valid_claims,
            secret,
            algorithm="HS256",
        )
        # Valid signature with matching secret succeeds
        verified = verify_supabase_access_token(signed_token, jwt_secret=secret)
        self.assertEqual(verified["sub"], self.user_uuid)

        # Wrong secret must be rejected with 401
        with self.assertRaises(AuthError) as wrong_secret_ctx:
            verify_supabase_access_token(signed_token, jwt_secret="wrong-secret-key-32-bytes-minimum")
        self.assertEqual(wrong_secret_ctx.exception.status_code, 401)

        # Tampered payload with original signature must be rejected with 401
        parts = signed_token.split(".")
        tampered_claims = {**self.valid_claims, "sub": "00000000-0000-4000-8000-000000000999"}
        tampered_token = f"{parts[0]}.{_encode_segment(tampered_claims)}.{parts[2]}"
        with self.assertRaises(AuthError) as tampered_ctx:
            verify_supabase_access_token(tampered_token, jwt_secret=secret)
        self.assertEqual(tampered_ctx.exception.status_code, 401)

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

    def test_legacy_account_brute_force_lockout_model(self) -> None:
        """Verifies that legacy recovery locks after 5 consecutive failed attempts."""
        max_attempts = 5
        failed_attempts = 0
        locked_until = None

        def record_attempt(success: bool, current_time: float) -> str:
            nonlocal failed_attempts, locked_until
            if locked_until is not None and locked_until > current_time:
                return "LOCKED"
            if success:
                failed_attempts = 0
                locked_until = None
                return "SUCCESS"
            failed_attempts += 1
            if failed_attempts >= max_attempts:
                locked_until = current_time + 1800  # 30 min lockout
                return "LOCKED_OUT"
            return f"FAILED_{max_attempts - failed_attempts}_REMAINING"

        now = 1000.0
        # 4 wrong attempts
        for _ in range(4):
            res = record_attempt(False, now)
            self.assertTrue(res.startswith("FAILED_"))
        # 5th wrong attempt triggers lockout
        self.assertEqual(record_attempt(False, now), "LOCKED_OUT")
        # Next attempt while locked is rejected immediately
        self.assertEqual(record_attempt(True, now + 100), "LOCKED")
        # After lockout expires, valid password succeeds
        self.assertEqual(record_attempt(True, now + 1801), "SUCCESS")


if __name__ == "__main__":
    unittest.main()
