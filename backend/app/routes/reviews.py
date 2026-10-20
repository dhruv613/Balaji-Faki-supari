"""Customer review submission and the public published-review endpoints."""

from __future__ import annotations

import json
import re
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Response, UploadFile
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..core.security import AuthenticatedPrincipal
from ..core.storage import (
    delete_private_review_photos,
    MAX_REQUEST_UPLOAD_BYTES,
    MAX_REVIEW_PHOTO_BYTES,
    ReviewPhotoStorageError,
    store_private_review_photo,
    validate_review_photo,
)
from ..db.models import AdminAuditLog, new_uuid_str, Order, Product, Review, ReviewPhoto
from ..db.session import get_db
from .common import _iso, _review_photo_response, _review_summary, get_current_principal

router = APIRouter()


def _serialize_customer_review(db: Session, review: Review) -> dict[str, Any]:
    order = db.get(Order, review.order_id)
    product = db.get(Product, review.product_id)
    name_parts = (order.shipping_name if order else "Customer").strip().split()
    customer_name = "Customer"
    if name_parts:
        customer_name = name_parts[0]
        if len(name_parts) > 1:
            customer_name += f" {name_parts[-1][0]}."
    return {
        "id": review.id,
        "orderId": review.order_id,
        "customerName": customer_name,
        "area": order.shipping_area if order else "",
        "product": product.slug if product else "",
        "productName": product.name if product else "Product",
        "packSize": order.items[0].pack_size if order and order.items else "",
        "rating": review.rating,
        "reviewText": review.review_text,
        "verifiedPurchase": review.is_verified_purchase,
        "createdAt": _iso(review.created_at),
        "photoUrls": [f"/api/reviews/photos/{photo.id}" for photo in review.photos],
        "adminReply": review.admin_reply,
        "adminRepliedAt": _iso(review.admin_replied_at) if review.admin_replied_at else None,
    }


MAX_REVIEW_PHOTOS = 5


@router.post("/orders/{order_id}/review", status_code=201)
def submit_customer_review(
    order_id: str,
    rating: int = Form(...),
    review_text: str = Form(..., alias="reviewText"),
    photos: list[UploadFile] = File(default=[]),
    principal: AuthenticatedPrincipal = Depends(get_current_principal),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Multipart review: rating, text and up to five private photos. Eligible reviews publish immediately."""
    if not 1 <= rating <= 5:
        raise HTTPException(status_code=422, detail="Rating must be between 1 and 5 stars.")
    cleaned_text = (review_text or "").strip()
    if len(cleaned_text) < 10 or len(cleaned_text) > 2000:
        raise HTTPException(status_code=422, detail="Write between 10 and 2000 characters about your purchase.")
    uploads = [photo for photo in photos if photo.filename]  # browsers send an empty part when nothing is chosen
    if len(uploads) > MAX_REVIEW_PHOTOS:
        raise HTTPException(status_code=422, detail=f"Attach no more than {MAX_REVIEW_PHOTOS} photos.")
    validated: list[tuple[bytes, str]] = []
    total_bytes = 0
    for upload in uploads:
        data = upload.file.read(MAX_REVIEW_PHOTO_BYTES + 1)
        total_bytes += len(data)
        if total_bytes > MAX_REQUEST_UPLOAD_BYTES:
            raise HTTPException(status_code=422, detail="Review photos together must be smaller than 4 MB.")
        try:
            validated.append((data, validate_review_photo(data, upload.content_type)))
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    order = db.scalar(select(Order).where(Order.id == order_id).with_for_update())
    if order is None:
        raise HTTPException(status_code=404, detail="Order not found.")
    if order.user_id != principal.id:
        raise HTTPException(status_code=403, detail="You can only review your own delivered order.")
    if order.status != "DELIVERED":
        raise HTTPException(status_code=409, detail="Reviews can only be submitted for delivered orders.")
    if db.scalar(select(Review.id).where(Review.order_id == order.id)) is not None:
        raise HTTPException(status_code=409, detail="A review has already been submitted for this order.")
    if not order.items:
        raise HTTPException(status_code=409, detail="This order has no product item to review.")

    review = Review(
        order_id=order.id,
        customer_id=order.customer_id,
        user_id=principal.id,
        product_id=order.items[0].product_id,
        rating=rating,
        review_text=cleaned_text,
        is_verified_purchase=True,
        moderation_status="PUBLISHED",
    )
    db.add(review)
    db.flush()
    stored_paths: list[str] = []
    try:
        for position, (data, mime_type) in enumerate(validated):
            photo_id = new_uuid_str()
            path = store_private_review_photo(
                user_id=principal.id, review_id=review.id, photo_id=photo_id, content=data, mime_type=mime_type
            )
            stored_paths.append(path)
            db.add(ReviewPhoto(id=photo_id, review_id=review.id, storage_path=path, mime_type=mime_type, position=position))
        db.add(
            AdminAuditLog(
                actor_id=principal.id,
                actor_email=principal.email,
                actor_role="CUSTOMER",
                action="REVIEW_SUBMITTED",
                module="REVIEWS",
                entity_type="REVIEW",
                entity_id=review.id,
                previous_state=None,
                new_state=json.dumps(
                    {"rating": review.rating, "moderationStatus": review.moderation_status, "photos": len(validated)}
                ),
            )
        )
        db.commit()
    except ReviewPhotoStorageError as exc:
        db.rollback()
        delete_private_review_photos(stored_paths)
        raise HTTPException(status_code=503, detail="Photo storage is unavailable. Please try again.") from exc
    except IntegrityError as exc:
        db.rollback()
        delete_private_review_photos(stored_paths)
        raise HTTPException(status_code=409, detail="A review has already been submitted for this order.") from exc
    except Exception:
        db.rollback()
        delete_private_review_photos(stored_paths)
        raise
    db.refresh(review)
    return _serialize_customer_review(db, review)


_REVIEW_SORT = {
    "newest": lambda: (Review.created_at.desc(),),
    "oldest": lambda: (Review.created_at.asc(),),
    "highest": lambda: (Review.rating.desc(), Review.created_at.desc()),
    "lowest": lambda: (Review.rating.asc(), Review.created_at.desc()),
}


@router.get("/reviews")
def list_published_reviews(
    product: str | None = None,
    sort: str = Query(default="newest", pattern="^(newest|oldest|highest|lowest)$"),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Public, PUBLISHED reviews only. Hidden reviews never appear in items, count or average."""
    statement = select(Review).where(Review.moderation_status == "PUBLISHED")
    product_id: str | None = None
    if product:
        slug = product.strip().lower()
        if not re.fullmatch(r"[a-z0-9-]{1,32}", slug):
            raise HTTPException(status_code=422, detail="Unknown product.")
        catalog_product = db.scalar(select(Product).where(Product.slug == slug))
        if catalog_product is None:
            return {"items": [], "total": 0, "summary": _review_summary(db, "unknown-product")}
        product_id = catalog_product.id
        statement = statement.where(Review.product_id == product_id)
    reviews = db.scalars(statement.order_by(*_REVIEW_SORT[sort]())).all()
    return {
        "items": [_serialize_customer_review(db, review) for review in reviews],
        "total": len(reviews),
        "summary": _review_summary(db, product_id),
    }


@router.get("/reviews/photos/{photo_id}")
def get_public_review_photo(photo_id: str, db: Session = Depends(get_db)) -> Response:
    """Photos are private in Storage; FastAPI serves them only while their review is PUBLISHED."""
    photo = db.get(ReviewPhoto, photo_id)
    if photo is None or photo.review.moderation_status != "PUBLISHED":
        raise HTTPException(status_code=404, detail="Photo not found.")
    return _review_photo_response(photo, "public, max-age=300")
