"""Private payment screenshot validation, storage, and short-lived signed proof URLs."""

from __future__ import annotations

import hashlib
import hmac
import os
import secrets
import time
from contextlib import closing, nullcontext
from functools import lru_cache

import boto3
from botocore.config import Config
from botocore.exceptions import (
    BotoCoreError, ClientError, ConnectionError as BotoConnectionError, HTTPClientError,
    InvalidRegionError, NoCredentialsError, NoRegionError, PartialCredentialsError,
)

from .config import Settings, settings
from .security import AuthError

ALLOWED_IMAGE_MIMES: dict[str, str] = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}
# Vercel Functions reject request bodies above 4.5 MB (413 FUNCTION_PAYLOAD_TOO_LARGE), so every upload, and the sum of a
# review's photos, stays under 4 MB.
MAX_REQUEST_UPLOAD_BYTES = 4 * 1024 * 1024
MAX_SCREENSHOT_BYTES = MAX_REQUEST_UPLOAD_BYTES
MAX_REVIEW_PHOTO_BYTES = MAX_REQUEST_UPLOAD_BYTES


class PrivateImageStorageError(RuntimeError):
    """Private image storage is unavailable or rejected an image object."""


class PaymentProofStorageError(PrivateImageStorageError):
    """Private image storage is unavailable or rejected a proof object."""


class ReviewPhotoStorageError(PrivateImageStorageError):
    """Private image storage is unavailable or rejected a review photo."""


class CatalogImageStorageError(PrivateImageStorageError):
    """Catalogue, shop or QR image storage is unavailable or rejected an object."""


MAX_CATALOG_IMAGE_BYTES = MAX_REQUEST_UPLOAD_BYTES
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
        raise ValueError(f"{label.capitalize()} must be smaller than {max_bytes // (1024 * 1024)} MB.")

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


@lru_cache(maxsize=4)
def _cached_client(endpoint: str, region: str | None):
    # boto3 clients are thread-safe; reuse one per endpoint instead of building one for every call.
    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        region_name=region,
        config=Config(
            signature_version="s3v4",
            s3={"addressing_style": "path"},
            connect_timeout=10,
            read_timeout=10,
            retries={"max_attempts": 2},
            request_checksum_calculation="when_required",
            response_checksum_validation="when_required",
        ),
    )


def _neon_client():
    return _cached_client(os.environ["AWS_ENDPOINT_URL_S3"].strip(), os.getenv("AWS_REGION"))


def _catalogue_storage_error_message(exc: Exception) -> str:
    # Fixed messages only: provider errors can contain credentials, signed URLs and request details.
    if isinstance(exc, ClientError):
        code = exc.response.get("Error", {}).get("Code")
        if code in {"SignatureDoesNotMatch", "AuthorizationHeaderMalformed"}:
            return "Neon Object Storage rejected the request signature. Check AWS_SECRET_ACCESS_KEY and AWS_REGION for the configured branch."
        return {
            "AccessDenied": "Access denied by Neon Object Storage. Check the credential's storage scope and branch access.",
            "InvalidAccessKeyId": "Neon Object Storage rejected the access key. Check AWS_ACCESS_KEY_ID for the configured branch.",
            "NoSuchBucket": "Neon Object Storage could not find the assets bucket. Check AWS_ENDPOINT_URL_S3 and the branch's storage setup.",
        }.get(code, "Image storage is unavailable.")
    if isinstance(exc, (NoCredentialsError, PartialCredentialsError)):
        return "Neon Object Storage credentials are missing or incomplete. Configure AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY on the API server."
    if isinstance(exc, (NoRegionError, InvalidRegionError)):
        return "Neon Object Storage region is not configured correctly. Check AWS_REGION on the API server."
    if isinstance(exc, (BotoConnectionError, HTTPClientError)):
        return "Cannot connect to Neon Object Storage. Check AWS_ENDPOINT_URL_S3 and the API server's network connection."
    return "Image storage is unavailable."


def create_catalogue_image_url(bucket: str, path: str, *, app_settings: Settings = settings) -> str:
    """Presign only public catalogue namespaces; payment proofs and review photos stay behind the API."""
    if bucket not in {app_settings.product_images_bucket, app_settings.store_photos_bucket}:
        raise ValueError("Only catalogue images can be shared publicly.")
    if not os.getenv("AWS_ENDPOINT_URL_S3", "").strip():
        raise CatalogImageStorageError("Neon Object Storage is not configured.")
    try:
        with nullcontext(_neon_client()) as client:
            return client.generate_presigned_url(
                "get_object", Params={"Bucket": "assets", "Key": f"{bucket}/{path.lstrip('/')}"}, ExpiresIn=3600,
            )
    except (BotoCoreError, ClientError) as exc:
        raise CatalogImageStorageError(_catalogue_storage_error_message(exc)) from exc


def _storage_request(
    method: str,
    bucket: str,
    path: str,
    *,
    app_settings: Settings,
    error_type: type[PrivateImageStorageError],
    content: bytes = b"",
    mime_type: str | None = None,
) -> bytes:
    if not os.getenv("AWS_ENDPOINT_URL_S3", "").strip():
        raise error_type("Neon Object Storage is not configured.")
    try:
        with nullcontext(_neon_client()) as client:
            object_args = {"Bucket": "assets", "Key": f"{bucket}/{path.lstrip('/')}"}
            if method == "POST":
                client.put_object(**object_args, Body=content, ContentType=mime_type, IfNoneMatch="*")
            elif method == "GET":
                with client.get_object(**object_args)["Body"] as body:
                    return body.read()
            else:
                client.delete_object(**object_args)
    except (BotoCoreError, ClientError, OSError) as exc:
        if isinstance(exc, ClientError) and method == "GET" and exc.response.get("Error", {}).get("Code") in {"NoSuchKey", "404", "NotFound"}:
            raise FileNotFoundError("Image object not found.") from exc
        message = _catalogue_storage_error_message(exc) if error_type is CatalogImageStorageError else "Image storage is unavailable."
        raise error_type(message) from exc
    return b""


def _read_image(
    bucket: str,
    path: str,
    *,
    app_settings: Settings,
    error_type: type[PrivateImageStorageError],
) -> tuple[bytes, str]:
    content = _storage_request("GET", bucket, path, app_settings=app_settings, error_type=error_type)
    mime = detect_image_mime(content)
    if mime is None:
        raise error_type("Stored object is not a valid image.")
    return content, mime


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
    _storage_request(
        "POST", app_settings.payment_proofs_bucket, relative_path,
        content=content, mime_type=mime_type, app_settings=app_settings, error_type=PaymentProofStorageError,
    )
    return relative_path


def read_private_payment_proof(
    storage_path: str,
    *,
    app_settings: Settings = settings,
) -> tuple[bytes, str]:
    """Reads private screenshot bytes and returns `(bytes, content_type)`."""
    return _read_image(
        app_settings.payment_proofs_bucket, storage_path,
        app_settings=app_settings, error_type=PaymentProofStorageError,
    )


def store_private_review_photo(
    *,
    user_id: str,
    review_id: str,
    photo_id: str,
    content: bytes,
    mime_type: str,
    app_settings: Settings = settings,
) -> str:
    """Saves a validated review photo in the private `review-photos` namespace."""
    ext = ALLOWED_IMAGE_MIMES.get(mime_type, ".png")
    relative_path = f"{user_id}/{review_id}/{photo_id}{ext}"
    _storage_request(
        "POST", app_settings.review_photos_bucket, relative_path,
        content=content, mime_type=mime_type, app_settings=app_settings, error_type=ReviewPhotoStorageError,
    )
    return relative_path


def read_private_review_photo(
    storage_path: str,
    *,
    app_settings: Settings = settings,
) -> tuple[bytes, str]:
    """Reads private review-photo bytes and returns `(bytes, content_type)`."""
    return _read_image(
        app_settings.review_photos_bucket, storage_path,
        app_settings=app_settings, error_type=ReviewPhotoStorageError,
    )


def delete_private_review_photos(
    storage_paths: list[str],
    *,
    app_settings: Settings = settings,
) -> None:
    """Best-effort cleanup for uploaded photos when the review transaction cannot commit."""
    for storage_path in storage_paths:
        try:
            _storage_request(
                "DELETE", app_settings.review_photos_bucket, storage_path,
                app_settings=app_settings, error_type=ReviewPhotoStorageError,
            )
        except ReviewPhotoStorageError:
            continue


_LOCAL_PROCESS_SIGNING_KEY = secrets.token_bytes(32)  # local development only; changes on every restart


def _signing_secret(app_settings: Settings = settings) -> bytes:
    """Domain-separated key for short-lived signed image URLs. Never falls back to a fixed string."""
    base = app_settings.proof_signing_secret
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
    _storage_request(
        "POST", bucket, path, content=content, mime_type=mime_type,
        app_settings=app_settings, error_type=CatalogImageStorageError,
    )


def get_storage_object(bucket: str, path: str, *, app_settings: Settings = settings) -> tuple[bytes, str]:
    return _read_image(bucket, path, app_settings=app_settings, error_type=CatalogImageStorageError)


def delete_storage_objects(bucket: str, paths: list[str], *, app_settings: Settings = settings) -> None:
    """Best-effort cleanup; a missing object or an unavailable service never raises."""
    for path in paths:
        try:
            _storage_request("DELETE", bucket, path, app_settings=app_settings, error_type=CatalogImageStorageError)
        except CatalogImageStorageError:
            continue
