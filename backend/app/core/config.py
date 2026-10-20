"""Environment configuration for Balaji Faki Point FastAPI backend."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path


def _load_dotenv_file(env_path: Path) -> None:
    if not env_path.is_file():
        return
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip("'").strip('"')
        if key and key not in os.environ:
            os.environ[key] = value


_BACKEND_DIR = Path(__file__).resolve().parents[2]
_ROOT_DIR = _BACKEND_DIR.parent
_load_dotenv_file(_ROOT_DIR / ".env.local")
_load_dotenv_file(_ROOT_DIR / ".env")
_load_dotenv_file(_BACKEND_DIR / ".env.local")
_load_dotenv_file(_BACKEND_DIR / ".env")

LOCAL_CORS_ORIGINS = "http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174"


def _configured_value(*keys: str, default: str = "") -> str:
    for key in keys:
        value = os.getenv(key, "").strip()
        if value:
            return value
    return default


def _default_auth_url() -> str:
    return _configured_value("NEON_AUTH_BASE_URL", "VITE_NEON_AUTH_URL").rstrip("/")


def _default_auth_jwks_url() -> str:
    base = _default_auth_url()
    return _configured_value("NEON_AUTH_JWKS_URL", default=f"{base}/.well-known/jwks.json" if base else "")


def _default_cors_origins() -> tuple[str, ...]:
    raw = _configured_value("CORS_ORIGINS", default=LOCAL_CORS_ORIGINS)
    return tuple(origin.strip() for origin in raw.split(",") if origin.strip())


@dataclass(frozen=True)
class Settings:
    neon_auth_base_url: str = field(default_factory=_default_auth_url)
    neon_auth_jwks_url: str = field(default_factory=_default_auth_jwks_url)
    database_url: str = field(
        default_factory=lambda: _configured_value("DATABASE_URL", "POSTGRES_URL")
    )
    cors_origins: tuple[str, ...] = field(
        default_factory=_default_cors_origins
    )
    proof_signing_secret: str = field(
        default_factory=lambda: os.getenv("PROOF_SIGNING_SECRET", "")
    )
    # The one Owner Admin login of the Admin Panel. Server-side only: never put these in VITE_* variables.
    admin_email: str = field(default_factory=lambda: os.getenv("ADMIN_EMAIL", "").strip().lower())
    admin_password: str = field(default_factory=lambda: os.getenv("ADMIN_PASSWORD", "").strip())
    # "local" enables explicit development-only conveniences (random per-process signing key, TEST bank evidence).
    # Anything else (including unset) is treated as non-local and fails closed.
    app_env: str = field(
        default_factory=lambda: os.getenv("BFP_ENV", "production").strip().lower() or "production"
    )
    payment_proofs_bucket: str = "payment-proofs"
    review_photos_bucket: str = "review-photos"
    product_images_bucket: str = "product-images"
    store_photos_bucket: str = "store-photos"
    payment_qr_bucket: str = "payment-qr"
    signed_url_ttl_seconds: int = 300

    @property
    def is_local_env(self) -> bool:
        return self.app_env == "local"


settings = Settings()
