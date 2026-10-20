"""Neon Auth JWT verification and server-side RBAC enforcement for FastAPI."""

from __future__ import annotations

import base64
import json
import time
from dataclasses import dataclass
from typing import Any

from urllib.parse import urlsplit

from .config import Settings, settings


class AuthError(Exception):
    """Raised when an access token is missing, forged, expired, or unauthorized."""

    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


@dataclass(frozen=True)
class AuthenticatedPrincipal:
    """Verified user identity resolved from a signed Neon Auth JWT and `public.user_profiles`."""

    id: str
    email: str
    full_name: str
    phone: str
    role: str  # 'CUSTOMER' | 'OWNER_ADMIN'
    is_active: bool


def extract_bearer_token(authorization_header: str | None) -> str:
    if not authorization_header:
        raise AuthError(401, "Authentication required. Missing Authorization Bearer header.")
    parts = authorization_header.strip().split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer" or not parts[1].strip():
        raise AuthError(401, "Invalid Authorization header format. Expected 'Bearer <access_token>'.")
    token = parts[1].strip()
    if token.count(".") != 2:
        raise AuthError(401, "A signed Neon Auth session token is required.")
    return token


def decode_unverified_jwt_parts(token: str) -> tuple[dict[str, Any], dict[str, Any]]:
    segments = token.split(".")
    if len(segments) != 3 or not all(segments):
        raise AuthError(401, "Malformed JWT access token.")

    def _decode_segment(seg: str) -> dict[str, Any]:
        padded = seg + "=" * (-len(seg) % 4)
        try:
            raw = base64.urlsafe_b64decode(padded.encode("ascii"))
            parsed = json.loads(raw.decode("utf-8"))
        except Exception as exc:
            raise AuthError(401, "Unreadable JWT segment.") from exc
        if not isinstance(parsed, dict):
            raise AuthError(401, "Invalid JWT structure.")
        return parsed

    return _decode_segment(segments[0]), _decode_segment(segments[1])


def auth_origin(base_url: str) -> str:
    parsed = urlsplit(base_url)
    return f"{parsed.scheme}://{parsed.netloc}" if parsed.scheme and parsed.netloc else ""


def validate_jwt_claims(
    claims: dict[str, Any], *, expected_issuer: str | None = None, now_epoch: float | None = None,
) -> dict[str, Any]:
    """Neon signs identity; application permissions always come from the profile table."""
    now = time.time() if now_epoch is None else now_epoch
    sub = claims.get("sub")
    if not isinstance(sub, str) or not sub.strip() or len(sub) > 255:
        raise AuthError(401, "JWT is missing a valid subject ('sub') claim.")
    for field in ("exp", "iat"):
        value = claims.get(field)
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise AuthError(401, f"JWT is missing a valid '{field}' claim.")
    if claims["exp"] <= now - CLOCK_SKEW_SECONDS or claims["iat"] > now + CLOCK_SKEW_SECONDS:
        raise AuthError(401, "Session token has expired or is not yet valid. Please sign in again.")
    if not claims.get("iss") or not claims.get("aud"):
        raise AuthError(401, "JWT issuer and audience are required.")
    if expected_issuer:
        audiences = claims["aud"] if isinstance(claims["aud"], list) else [claims["aud"]]
        if claims["iss"] != expected_issuer or expected_issuer not in audiences:
            raise AuthError(401, "JWT issuer or audience does not match the configured Neon Auth branch.")
    return claims


_JWK_CLIENTS: dict[str, object] = {}
_JWKS_REFETCHED_AT: dict[str, float] = {}
JWKS_MIN_REFETCH_SECONDS = 60
CLOCK_SKEW_SECONDS = 60


def _jwk_client(url: str):
    """One PyJWKClient per JWKS URL so signing keys are cached instead of fetched on every request."""
    from jwt import PyJWKClient

    client = _JWK_CLIENTS.get(url)
    if client is None:
        client = PyJWKClient(url, cache_keys=True, lifespan=600, timeout=5)
        _JWK_CLIENTS[url] = client
    return client


def _signing_key(url: str, kid: object):
    """Key for `kid` from the cached key set. An unknown kid refetches the set at most once a minute, so forged
    tokens with random kids cannot make every request wait on an outbound call (genuine key rotation still works)."""
    client = _jwk_client(url)
    if not isinstance(kid, str) or not kid:
        raise AuthError(401, "Invalid or expired Neon Auth session token.")
    for refresh in (False, True):
        if refresh:
            now = time.monotonic()
            if now - _JWKS_REFETCHED_AT.get(url, float("-inf")) < JWKS_MIN_REFETCH_SECONDS:
                break
            _JWKS_REFETCHED_AT[url] = now
        for key in client.get_jwk_set(refresh=refresh).keys:
            if key.key_id == kid:
                return key
    raise AuthError(401, "Invalid or expired Neon Auth session token.")


def verify_access_token(token: str, *, app_settings: Settings = settings) -> dict[str, Any]:
    """Verify Managed Neon Auth Ed25519 signatures and its origin-scoped issuer/audience."""
    header, _ = decode_unverified_jwt_parts(token)
    if header.get("alg") != "EdDSA":
        raise AuthError(401, "Only signed Neon Auth EdDSA tokens are accepted.")
    issuer = auth_origin(app_settings.neon_auth_base_url)
    if not issuer or not app_settings.neon_auth_jwks_url:
        raise AuthError(503, "Neon Auth is not configured on this server.")
    try:
        import jwt
        signing_key = _signing_key(app_settings.neon_auth_jwks_url, header.get("kid"))
        claims = jwt.decode(
            token, signing_key.key, algorithms=["EdDSA"], audience=issuer, issuer=issuer, leeway=CLOCK_SKEW_SECONDS,
            options={"require": ["exp", "iat", "sub", "iss", "aud"]},
        )
    except AuthError:
        raise
    except Exception as exc:
        raise AuthError(401, "Invalid or expired Neon Auth session token.") from exc
    return validate_jwt_claims(claims, expected_issuer=issuer)


def resolve_authenticated_principal(
    claims: dict[str, Any],
    profile_row: dict[str, Any] | None,
) -> AuthenticatedPrincipal:
    """
    Resolves the authoritative `AuthenticatedPrincipal` from verified JWT claims and the
    server-side `public.user_profiles` row.

    Security rule:
    - `user_metadata` is NEVER used to determine `role` or `is_active`.
    - Only `profile_row['role'] == 'OWNER_ADMIN'` (from PostgreSQL `public.user_profiles`)
      grants Owner Admin permissions.
    """
    validated = validate_jwt_claims(claims)
    if profile_row is None or profile_row.get("auth_subject") != validated["sub"]:
        raise AuthError(403, "This identity has not been linked to an application account.")
    if not profile_row.get("is_active", True):
        raise AuthError(403, "This account has been deactivated.")
    return AuthenticatedPrincipal(
        id=str(profile_row["id"]),
        email=str(profile_row.get("email") or "").strip().lower(),
        full_name=str(profile_row.get("full_name") or ""),
        phone=str(profile_row.get("phone") or ""),
        role="OWNER_ADMIN" if profile_row.get("role") == "OWNER_ADMIN" else "CUSTOMER",
        is_active=True,
    )


def enforce_owner_admin(principal: AuthenticatedPrincipal) -> AuthenticatedPrincipal:
    """Raises 403 Forbidden unless the principal is an active `OWNER_ADMIN`."""
    if not principal.is_active:
        raise AuthError(403, "This account has been deactivated.")
    if principal.role != "OWNER_ADMIN":
        raise AuthError(
            403,
            "Owner Admin permissions are required for this action. Customer accounts are forbidden.",
        )
    return principal
