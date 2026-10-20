"""Real Ed25519 test JWTs; only the JWKS transport and managed identity table are substituted."""
from dataclasses import replace
from types import SimpleNamespace
from unittest.mock import patch
import time
import jwt
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from app.core import security

KEY = Ed25519PrivateKey.generate()
ISSUER = "https://test-auth.neonauth.example"
SETTINGS = replace(security.settings, neon_auth_base_url=ISSUER + "/neondb/auth", neon_auth_jwks_url=ISSUER + "/neondb/auth/.well-known/jwks.json")
IDENTITIES = {}


def mint_token(subject, email, name="Test User", **extra):
    claims = {"sub": subject, "email": email, "name": name, "emailVerified": True,
              "iss": ISSUER, "aud": ISSUER, "iat": int(time.time()), "exp": int(time.time()) + 900, **extra}
    IDENTITIES[subject] = {"id": subject, "email": email, "name": name, "emailVerified": True, "banned": False}
    return jwt.encode(claims, KEY, algorithm="EdDSA", headers={"kid": "test-key"})


def start_auth(test_class):
    client = SimpleNamespace(get_jwk_set=lambda refresh=False: SimpleNamespace(keys=[SimpleNamespace(key_id="test-key", key=KEY.public_key())]))
    for replacement in (
        patch("app.core.security._jwk_client", return_value=client),
        patch("app.main.verify_access_token", side_effect=lambda token: security.verify_access_token(token, app_settings=SETTINGS)),
        patch("app.main._lookup_auth_identity", side_effect=lambda db, subject: IDENTITIES.get(subject)),
    ):
        replacement.start()
        test_class.addClassCleanup(replacement.stop)
