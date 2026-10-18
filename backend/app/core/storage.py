"""Private payment screenshot validation, storage, and short-lived signed proof URLs."""

from __future__ import annotations

import hashlib
import hmac
import time
from pathlib import Path

from .config import Settings, settings
from .security import AuthError

ALLOWED_IMAGE_MIMES: dict[str, str] = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}
MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024  # 5 MB

_BACKEND_DIR = Path(__file__).resolve().parents[2]
_PRIVATE_STORAGE_ROOT = _BACKEND_DIR / ".private_storage" / "payment-proofs"


def detect_image_mime(content: bytes) -> str | None:
    """Inspects file magic bytes to verify genuine JPEG, PNG, or WEBP image content."""
    if len(content) >= 3 and content[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if len(content) >= 8 and content[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if len(content) >= 12 and content[:4] == b"RIFF" and content[8:12] == b"WEBP":
        return "image/webp"
    return None


def validate_payment_screenshot(content: bytes, declared_content_type: str | None) -> str:
    """
    Validates screenshot size, declared MIME type, and actual image magic bytes.
    Returns the verified MIME type or raises ValueError with a user-safe message.
    """
    if not content:
        raise ValueError("The screenshot file is empty.")
    if len(content) > MAX_SCREENSHOT_BYTES:
        raise ValueError("Screenshot must be smaller than 5 MB.")

    normalized_mime = (declared_content_type or "").split(";")[0].strip().lower()
    if normalized_mime not in ALLOWED_IMAGE_MIMES:
        raise ValueError("Upload a JPG, PNG or WEBP image.")

    detected_mime = detect_image_mime(content)
    if detected_mime is None:
        raise ValueError("Uploaded file is not a valid JPG, PNG, or WEBP image.")
    if detected_mime != normalized_mime:
        raise ValueError("File content does not match the declared image format.")

    return detected_mime


def _resolve_storage_root(storage_root: Path | None = None) -> Path:
    import os

    if storage_root is not None:
        return storage_root
    env_root = os.getenv("PRIVATE_STORAGE_ROOT", "").strip()
    if env_root:
        return Path(env_root) / "payment-proofs"
    return _PRIVATE_STORAGE_ROOT


def store_private_payment_proof(
    *,
    user_id: str,
    order_id: str,
    payment_id: str,
    content: bytes,
    mime_type: str,
    storage_root: Path | None = None,
) -> str:
    """
    Saves a validated screenshot inside the private `payment-proofs` storage namespace.
    Returns the logical private storage path `<user_id>/<order_id>/<payment_id>.<ext>`.
    """
    ext = ALLOWED_IMAGE_MIMES.get(mime_type, ".png")
    relative_path = f"{user_id}/{order_id}/{payment_id}{ext}"
    root = _resolve_storage_root(storage_root)
    target = (root / relative_path).resolve()
    root_resolved = root.resolve()
    if root_resolved not in target.parents:
        raise ValueError("Invalid storage object path.")

    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(content)
    return relative_path


def read_private_payment_proof(
    storage_path: str,
    *,
    storage_root: Path | None = None,
) -> tuple[bytes, str]:
    """Reads private screenshot bytes and returns `(bytes, content_type)`."""
    root = _resolve_storage_root(storage_root).resolve()
    target = (root / storage_path.lstrip("/")).resolve()
    if root not in target.parents or not target.is_file():
        raise FileNotFoundError("Payment proof object not found in private storage.")

    content = target.read_bytes()
    mime = detect_image_mime(content) or "image/png"
    return content, mime


def _signing_secret(app_settings: Settings = settings) -> bytes:
    raw = (
        app_settings.supabase_jwt_secret
        or app_settings.supabase_secret_key
        or "bfp-local-dev-proof-signing-secret-do-not-expose"
    )
    return raw.encode("utf-8")


def create_signed_proof_query(
    payment_id: str,
    storage_path: str,
    *,
    ttl_seconds: int | None = None,
    now_epoch: int | None = None,
    app_settings: Settings = settings,
) -> tuple[str, int]:
    """Creates a short-lived HMAC-SHA256 signature and expiry timestamp for a private proof URL."""
    now = int(time.time()) if now_epoch is None else int(now_epoch)
    ttl = ttl_seconds if ttl_seconds is not None else app_settings.signed_url_ttl_seconds
    exp = now + max(30, int(ttl))
    message = f"{payment_id}:{storage_path}:{exp}".encode("utf-8")
    sig = hmac.new(_signing_secret(app_settings), message, hashlib.sha256).hexdigest()
    return sig, exp


def verify_signed_proof_query(
    payment_id: str,
    storage_path: str,
    *,
    sig: str | None,
    exp: int | None,
    now_epoch: int | None = None,
    app_settings: Settings = settings,
) -> bool:
    """Verifies a short-lived HMAC signature for viewing a private payment screenshot."""
    if not sig or exp is None:
        return False
    now = int(time.time()) if now_epoch is None else int(now_epoch)
    if int(exp) <= now:
        return False
    expected_sig, _ = create_signed_proof_query(
        payment_id,
        storage_path,
        ttl_seconds=int(exp) - now,
        now_epoch=now,
        app_settings=app_settings,
    )
    return hmac.compare_digest(sig, expected_sig)
