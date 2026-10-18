"""Supabase JWT verification and server-side RBAC enforcement for FastAPI."""

from __future__ import annotations

import base64
import json
import time
import uuid
from dataclasses import dataclass
from typing import Any, Callable, Protocol

from .config import Settings, settings


class AuthError(Exception):
    """Raised when an access token is missing, forged, expired, or unauthorized."""

    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


@dataclass(frozen=True)
class AuthenticatedPrincipal:
    """Verified user identity resolved from a signed Supabase JWT and `public.user_profiles`."""

    id: str
    email: str
    full_name: str
    phone: str
    role: str  # 'CUSTOMER' | 'OWNER_ADMIN'
    is_active: bool


class ProfileLookup(Protocol):
    def __call__(self, user_id: str, email: str, user_metadata: dict[str, Any]) -> dict[str, Any] | None: ...


def extract_bearer_token(authorization_header: str | None) -> str:
    if not authorization_header:
        raise AuthError(401, "Authentication required. Missing Authorization Bearer header.")
    parts = authorization_header.strip().split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer" or not parts[1].strip():
        raise AuthError(401, "Invalid Authorization header format. Expected 'Bearer <access_token>'.")
    token = parts[1].strip()
    if token.startswith("bfp-session-") or token.startswith("sb_publishable_") or token.startswith("sb_secret_"):
        raise AuthError(401, "Synthetic or non-JWT tokens are rejected. Sign in via Supabase Auth.")
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


def validate_jwt_claims(
    claims: dict[str, Any],
    *,
    expected_issuer_prefix: str | None = None,
    now_epoch: float | None = None,
) -> dict[str, Any]:
    """
    Enforces strict Supabase user JWT invariants:
    - Rejects `anon` and `service_role` tokens (must be a signed user session token).
    - Requires a valid UUID `sub` claim (`auth.uid()`).
    - Verifies `aud == 'authenticated'` and non-expired `exp`.
    - Never uses `user_metadata` for role or permission decisions.
    """
    now = time.time() if now_epoch is None else now_epoch

    jwt_role = str(claims.get("role") or "")
    if jwt_role in ("anon", "service_role"):
        raise AuthError(401, "API keys (anon/service_role) cannot be used as user session tokens.")
    if jwt_role != "authenticated":
        raise AuthError(401, "Token role must be 'authenticated'.")

    aud = claims.get("aud")
    aud_valid = aud == "authenticated" or (isinstance(aud, list) and "authenticated" in aud)
    if not aud_valid:
        raise AuthError(401, "Invalid JWT audience; expected 'authenticated'.")

    sub = str(claims.get("sub") or "").strip()
    try:
        uuid.UUID(sub)
    except ValueError as exc:
        raise AuthError(401, "JWT is missing a valid UUID subject ('sub') claim.") from exc

    exp = claims.get("exp")
    if not isinstance(exp, (int, float)) or float(exp) <= now:
        raise AuthError(401, "Session token has expired. Please sign in again.")

    if expected_issuer_prefix:
        iss = str(claims.get("iss") or "")
        expected_iss = f"{expected_issuer_prefix.rstrip('/')}/auth/v1"
        if iss and iss.rstrip("/") != expected_iss:
            raise AuthError(401, "JWT issuer does not match the configured Supabase project.")

    return claims


def verify_supabase_access_token(
    token: str,
    *,
    app_settings: Settings = settings,
    jwt_secret: str | None = None,
    jwks_verifier: Callable[[str], dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """
    Cryptographically verifies a signed Supabase Auth access token via JWKS (ES256/RS256)
    or `SUPABASE_JWT_SECRET` (HS256), then validates all security claims.
    """
    import os

    if app_settings.supabase_publishable_key and token == app_settings.supabase_publishable_key:
        raise AuthError(401, "Publishable/anon key cannot be used as a user Bearer token.")

    header, _unverified_claims = decode_unverified_jwt_parts(token)
    alg = str(header.get("alg") or "").upper()
    if alg in ("", "NONE"):
        raise AuthError(401, "Unsigned JWT tokens are strictly rejected.")

    if jwks_verifier is not None:
        verified_claims = jwks_verifier(token)
        return validate_jwt_claims(verified_claims, expected_issuer_prefix=app_settings.supabase_url)

    try:
        import jwt
        from jwt import PyJWKClient
    except ImportError as exc:
        raise AuthError(500, "PyJWT is required on the server to verify signed tokens.") from exc

    expected_issuer = f"{app_settings.supabase_url.rstrip('/')}/auth/v1"
    effective_jwt_secret = (
        jwt_secret
        if jwt_secret is not None
        else (app_settings.supabase_jwt_secret or os.getenv("SUPABASE_JWT_SECRET", ""))
    )
    try:
        if alg in ("ES256", "RS256", "EDDSA") and app_settings.supabase_jwks_url:
            jwk_client = PyJWKClient(app_settings.supabase_jwks_url)
            signing_key = jwk_client.get_signing_key_from_jwt(token)
            verified_claims = jwt.decode(
                token,
                signing_key.key,
                algorithms=[alg],
                audience="authenticated",
                issuer=expected_issuer,
            )
        elif alg == "HS256" and effective_jwt_secret:
            verified_claims = jwt.decode(
                token,
                effective_jwt_secret,
                algorithms=["HS256"],
                audience="authenticated",
                issuer=expected_issuer,
            )
        else:
            raise AuthError(401, f"Unsupported or unconfigured JWT signing algorithm ({alg}).")
    except AuthError:
        raise
    except Exception as exc:
        raise AuthError(401, f"Invalid or expired Supabase JWT signature: {exc}") from exc

    return validate_jwt_claims(verified_claims, expected_issuer_prefix=app_settings.supabase_url)


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
    user_id = str(validated["sub"])
    email = str(validated.get("email") or "").strip().lower()
    raw_user_meta = validated.get("user_metadata")
    user_meta = raw_user_meta if isinstance(raw_user_meta, dict) else {}

    if profile_row is not None:
        is_active = bool(profile_row.get("is_active", True))
        if not is_active:
            raise AuthError(403, "This account has been deactivated.")
        db_role = str(profile_row.get("role") or "CUSTOMER")
        role = "OWNER_ADMIN" if db_role == "OWNER_ADMIN" else "CUSTOMER"
        full_name = str(profile_row.get("full_name") or user_meta.get("fullName") or "").strip()
        phone = str(profile_row.get("phone") or user_meta.get("phone") or "").strip()
        resolved_email = str(profile_row.get("email") or email).strip().lower()
    else:
        # Default newly authenticated users without a profile row to CUSTOMER (never OWNER_ADMIN)
        is_active = True
        role = "CUSTOMER"
        full_name = str(user_meta.get("fullName") or "").strip()
        phone = str(user_meta.get("phone") or "").strip()
        resolved_email = email

    return AuthenticatedPrincipal(
        id=user_id,
        email=resolved_email,
        full_name=full_name,
        phone=phone,
        role=role,
        is_active=is_active,
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
