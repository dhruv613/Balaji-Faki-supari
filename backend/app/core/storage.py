"""Private payment screenshot validation, storage, and short-lived signed proof URLs."""

from __future__ import annotations

import hashlib
import hmac
import secrets
import time
from urllib.parse import quote

import httpx

from .config import Settings, settings
from .security import AuthError

ALLOWED_IMAGE_MIMES: dict[str, str] = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}
MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024  # 5 MB
MAX_REVIEW_PHOTO_BYTES = 5 * 1024 * 1024  # 5 MB


class PrivateImageStorageError(RuntimeError):
    """Private Supabase Storage is unavailable or rejected an image object."""


class PaymentProofStorageError(PrivateImageStorageError):
    """Private Supabase Storage is unavailable or rejected a proof object."""


class ReviewPhotoStorageError(PrivateImageStorageError):
    """Private Supabase Storage is unavailable or rejected a review photo."""


class CatalogImageStorageError(PrivateImageStorageError):
    """Catalogue, shop or QR image storage is unavailable or rejected an object."""


MAX_CATALOG_IMAGE_BYTES = 5 * 1024 * 1024
MAX_QR_IMAGE_BYTES = 2 * 1024 * 1024


def detect_image_mime(content: bytes) -> str | None:
    """Inspects file magic bytes to verify genuine JPEG, PNG, or WEBP image content."""
    if len(content) >= 3 and content[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if len(content) >= 8 and content[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if len(content) >= 12 and content[:4] == b"RIFF" and content[8:12] == b"WEBP":
        return "image/webp"
    return None


def _validate_image_upload(
    content: bytes,
    declared_content_type: str | None,
    *,
    label: str,
    max_bytes: int,
) -> str:
    if not content:
        raise ValueError(f"The {label} file is empty.")
    if len(content) > max_bytes:
        raise ValueError(f"{label.capitalize()} must be smaller than 5 MB.")

    normalized_mime = (declared_content_type or "").split(";")[0].strip().lower()
    if normalized_mime not in ALLOWED_IMAGE_MIMES:
        raise ValueError("Upload a JPG, PNG or WEBP image.")

    detected_mime = detect_image_mime(content)
    if detected_mime is None:
        raise ValueError("Uploaded file is not a valid JPG, PNG, or WEBP image.")
    if detected_mime != normalized_mime:
        raise ValueError("File content does not match the declared image format.")

    return detected_mime


def validate_payment_screenshot(content: bytes, declared_content_type: str | None) -> str:
    """Validates a payment screenshot's size, declared MIME type, and image bytes."""
    return _validate_image_upload(
        content,
        declared_content_type,
        label="screenshot",
        max_bytes=MAX_SCREENSHOT_BYTES,
    )


def validate_review_photo(content: bytes, declared_content_type: str | None) -> str:
    """Validates a review photo's size, declared MIME type, and image bytes."""
    return _validate_image_upload(
        content,
        declared_content_type,
        label="review photo",
        max_bytes=MAX_REVIEW_PHOTO_BYTES,
    )


def _storage_headers(
    app_settings: Settings,
    mime_type: str | None = None,
    *,
    error_type: type[PrivateImageStorageError] = PaymentProofStorageError,
) -> dict[str, str]:
    secret = app_settings.supabase_secret_key.strip()
    if not secret:
        raise error_type("Private image storage is not configured.")
    headers = {"Authorization": f"Bearer {secret}", "apikey": secret}
    if mime_type:
        headers["Content-Type"] = mime_type
    return headers


def _storage_object_url(storage_path: str, app_settings: Settings, bucket_name: str) -> str:
    base_url = app_settings.supabase_url.rstrip("/")
    bucket = quote(bucket_name, safe="")
    object_path = quote(storage_path.lstrip("/"), safe="/")
    return f"{base_url}/storage/v1/object/{bucket}/{object_path}"


def store_private_payment_proof(
    *,
    user_id: str,
    order_id: str,
    payment_id: str,
    content: bytes,
    mime_type: str,
    app_settings: Settings = settings,
) -> str:
    """
    Saves a validated screenshot inside the private `payment-proofs` storage namespace.
    Returns the logical private storage path `<user_id>/<order_id>/<payment_id>.<ext>`.
    """
    ext = ALLOWED_IMAGE_MIMES.get(mime_type, ".png")
    relative_path = f"{user_id}/{order_id}/{payment_id}{ext}"
    try:
        response = httpx.request(
            "POST",
            _storage_object_url(relative_path, app_settings, app_settings.payment_proofs_bucket),
            headers={**_storage_headers(app_settings, mime_type), "x-upsert": "false"},
            content=content,
            timeout=10,
        )
        response.raise_for_status()
    except httpx.HTTPError as exc:
        raise PaymentProofStorageError("Private payment proof storage is unavailable.") from exc
    return relative_path


def read_private_payment_proof(
    storage_path: str,
    *,
    app_settings: Settings = settings,
) -> tuple[bytes, str]:
    """Reads private screenshot bytes and returns `(bytes, content_type)`."""
    try:
        response = httpx.request(
            "GET",
            _storage_object_url(storage_path, app_settings, app_settings.payment_proofs_bucket),
            headers=_storage_headers(app_settings),
            timeout=10,
        )
    except httpx.HTTPError as exc:
        raise PaymentProofStorageError("Private payment proof storage is unavailable.") from exc
    if response.status_code == 404:
        raise FileNotFoundError("Payment proof object not found in private storage.")
    try:
        response.raise_for_status()
    except httpx.HTTPError as exc:
        raise PaymentProofStorageError("Private payment proof storage is unavailable.") from exc

    mime = detect_image_mime(response.content)
    if mime is None:
        raise PaymentProofStorageError("Stored payment proof is not a valid image.")
    return response.content, mime


def store_private_review_photo(
    *,
    user_id: str,
    review_id: str,
    photo_id: str,
    content: bytes,
    mime_type: str,
    app_settings: Settings = settings,
) -> str:
    """Saves a validated review photo in the private `review-photos` bucket."""
    ext = ALLOWED_IMAGE_MIMES.get(mime_type, ".png")
    relative_path = f"{user_id}/{review_id}/{photo_id}{ext}"
    try:
        response = httpx.request(
            "POST",
            _storage_object_url(relative_path, app_settings, app_settings.review_photos_bucket),
            headers={
                **_storage_headers(app_settings, mime_type, error_type=ReviewPhotoStorageError),
                "x-upsert": "false",
            },
            content=content,
            timeout=10,
        )
        response.raise_for_status()
    except PrivateImageStorageError:
        raise
    except httpx.HTTPError as exc:
        raise ReviewPhotoStorageError("Private review photo storage is unavailable.") from exc
    return relative_path


def read_private_review_photo(
    storage_path: str,
    *,
    app_settings: Settings = settings,
) -> tuple[bytes, str]:
    """Reads private review-photo bytes and returns `(bytes, content_type)`."""
    try:
        response = httpx.request(
            "GET",
            _storage_object_url(storage_path, app_settings, app_settings.review_photos_bucket),
            headers=_storage_headers(app_settings, error_type=ReviewPhotoStorageError),
            timeout=10,
        )
    except PrivateImageStorageError:
        raise
    except httpx.HTTPError as exc:
        raise ReviewPhotoStorageError("Private review photo storage is unavailable.") from exc
    if response.status_code == 404:
        raise FileNotFoundError("Review photo object not found in private storage.")
    try:
        response.raise_for_status()
    except httpx.HTTPError as exc:
        raise ReviewPhotoStorageError("Private review photo storage is unavailable.") from exc

    mime = detect_image_mime(response.content)
    if mime is None:
        raise ReviewPhotoStorageError("Stored review photo is not a valid image.")
    return response.content, mime


def delete_private_review_photos(
    storage_paths: list[str],
    *,
    app_settings: Settings = settings,
) -> None:
    """Best-effort cleanup for uploaded photos when the review transaction cannot commit."""
    try:
        headers = _storage_headers(app_settings, error_type=ReviewPhotoStorageError)
    except ReviewPhotoStorageError:
        return
    for storage_path in storage_paths:
        try:
            response = httpx.request(
                "DELETE",
                _storage_object_url(storage_path, app_settings, app_settings.review_photos_bucket),
                headers=headers,
                timeout=10,
            )
            response.raise_for_status()
        except httpx.HTTPError:
            continue


_LOCAL_PROCESS_SIGNING_KEY = secrets.token_bytes(32)  # local development only; changes on every restart


def _signing_secret(app_settings: Settings = settings) -> bytes:
    """Domain-separated key for short-lived signed image URLs. Never falls back to a fixed string."""
    base = app_settings.proof_signing_secret or app_settings.supabase_jwt_secret or app_settings.supabase_secret_key
    if base:
        return hmac.new(base.encode("utf-8"), b"bfp-signed-image-url-v1", hashlib.sha256).digest()
    if app_settings.is_local_env:
        return _LOCAL_PROCESS_SIGNING_KEY
    raise PrivateImageStorageError("Signed image URLs are not configured on this server.")


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


def validate_catalog_image(content: bytes, declared_content_type: str | None, *, max_bytes: int = MAX_CATALOG_IMAGE_BYTES) -> str:
    """Validates a product/shop/QR image upload (size, declared type, magic bytes)."""
    return _validate_image_upload(content, declared_content_type, label="image", max_bytes=max_bytes)


def put_storage_object(
    bucket: str,
    path: str,
    content: bytes,
    mime_type: str,
    *,
    app_settings: Settings = settings,
) -> None:
    """Uploads a validated image with the server-side credential. Never overwrites an existing object."""
    try:
        response = httpx.request(
            "POST",
            _storage_object_url(path, app_settings, bucket),
            headers={**_storage_headers(app_settings, mime_type, error_type=CatalogImageStorageError), "x-upsert": "false"},
            content=content,
            timeout=10,
        )
        response.raise_for_status()
    except PrivateImageStorageError:
        raise
    except httpx.HTTPError as exc:
        raise CatalogImageStorageError("Image storage is unavailable.") from exc


def get_storage_object(bucket: str, path: str, *, app_settings: Settings = settings) -> tuple[bytes, str]:
    try:
        response = httpx.request(
            "GET",
            _storage_object_url(path, app_settings, bucket),
            headers=_storage_headers(app_settings, error_type=CatalogImageStorageError),
            timeout=10,
        )
    except PrivateImageStorageError:
        raise
    except httpx.HTTPError as exc:
        raise CatalogImageStorageError("Image storage is unavailable.") from exc
    if response.status_code == 404:
        raise FileNotFoundError("Image object not found.")
    try:
        response.raise_for_status()
    except httpx.HTTPError as exc:
        raise CatalogImageStorageError("Image storage is unavailable.") from exc
    mime = detect_image_mime(response.content)
    if mime is None:
        raise CatalogImageStorageError("Stored object is not a valid image.")
    return response.content, mime


def delete_storage_objects(bucket: str, paths: list[str], *, app_settings: Settings = settings) -> None:
    """Best-effort cleanup; a missing object or an unavailable service never raises."""
    try:
        headers = _storage_headers(app_settings, error_type=CatalogImageStorageError)
    except CatalogImageStorageError:
        return
    for path in paths:
        try:
            httpx.request("DELETE", _storage_object_url(path, app_settings, bucket), headers=headers, timeout=10)
        except httpx.HTTPError:
            continue
