"""Private, compact payment-proof receipts and delivery-time screenshot cleanup."""

from __future__ import annotations

import csv
import io
import logging
import re
import zipfile
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from PIL import Image, ImageOps
from pydantic import BaseModel, Field
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..core.config import settings
from ..core.security import AuthenticatedPrincipal
from ..core.storage import (
    CatalogImageStorageError,
    PaymentProofStorageError,
    delete_private_payment_proof,
    get_storage_object,
    read_private_payment_proof,
    read_private_payment_receipt,
    store_private_payment_receipt,
)
from ..db.models import Order, PaymentAttempt, StoreSettings
from ..db.session import get_db
from .common import _resolve_order_by_id_or_number, get_current_principal, get_owner_admin_principal

router = APIRouter()
logger = logging.getLogger(__name__)
MAX_ARCHIVE_BYTES = 4 * 1024 * 1024  # Vercel's buffered function response limit is 4.5 MB.


def _receipt_path(payment: PaymentAttempt) -> str:
    return f"{payment.order_id}/{payment.id}.pdf"


def _valid_receipt(content: bytes) -> bool:
    return content.startswith(b"%PDF-") and b"%%EOF" in content[-64:] and content.count(b"/Subtype /Image") >= 2


def _receipt_filename(order: Order, payment: PaymentAttempt) -> str:
    number = re.sub(r"[^A-Za-z0-9-]", "", order.order_number).strip("-") or order.id[:8]
    return f"{number}-{payment.id[:8]}-payment-proof.pdf"


def _receipt_image(content: bytes, max_pixels: int, *, jpeg: bool) -> bytes:
    with Image.open(io.BytesIO(content)) as source:
        if source.width * source.height > 20_000_000:
            raise ValueError("Payment image dimensions are too large for a receipt.")
        image = ImageOps.exif_transpose(source)
        image.thumbnail((max_pixels, max_pixels), Image.Resampling.LANCZOS)
        background = Image.new("RGB", image.size, "white")
        background.paste(image, mask=image.getchannel("A") if "A" in image.getbands() else None)
        output = io.BytesIO()
        background.save(output, format="JPEG" if jpeg else "PNG", quality=82, optimize=True)
        return output.getvalue()


def _draw_image(pdf: canvas.Canvas, content: bytes, x: float, y: float, width_limit: float, height_limit: float) -> None:
    image = ImageReader(io.BytesIO(content))
    width, height = image.getSize()
    scale = min(width_limit / width, height_limit / height)
    shown_width, shown_height = width * scale, height * scale
    pdf.drawImage(image, x + (width_limit - shown_width) / 2, y + (height_limit - shown_height) / 2,
                  shown_width, shown_height, mask="auto")


def _build_receipt_pdf(payment: PaymentAttempt, order: Order, store: StoreSettings,
                       screenshot: bytes, qr: bytes) -> bytes:
    payer_image = _receipt_image(screenshot, 1200, jpeg=True)
    receiver_image = _receipt_image(qr, 600, jpeg=False)
    output = io.BytesIO()
    pdf = canvas.Canvas(output, pagesize=(595, 842), pageCompression=1)
    pdf.setTitle(f"Payment proof receipt {order.order_number}")
    pdf.setFont("Helvetica-Bold", 20)
    pdf.drawString(42, 788, "Balaji Faki Point")
    pdf.setFont("Helvetica", 11)
    pdf.drawString(42, 761, "Payment proof receipt")
    pdf.setFont("Helvetica-Bold", 11)
    pdf.drawString(42, 725, f"Order: {order.order_number}")
    pdf.drawString(42, 705, f"Amount submitted: INR {payment.expected_amount_paise // 100:,}.{payment.expected_amount_paise % 100:02d}")
    submitted = payment.submitted_at.replace(tzinfo=ZoneInfo("UTC")) if payment.submitted_at.tzinfo is None else payment.submitted_at
    pdf.setFont("Helvetica", 10)
    pdf.drawString(42, 685, f"Proof uploaded: {submitted.astimezone(ZoneInfo('Asia/Kolkata')).strftime('%d %b %Y, %I:%M %p')} IST")
    pdf.drawString(42, 665, f"Payment attempt: {payment.id}")
    pdf.drawString(42, 642, f"Receiver UPI: {(store.upi_id or '')[:90]}")
    pdf.setLineWidth(0.6)
    pdf.line(42, 621, 553, 621)
    pdf.setFont("Helvetica-Bold", 11)
    pdf.drawString(42, 595, "Receiver QR")
    pdf.rect(42, 326, 258, 258)
    _draw_image(pdf, receiver_image, 49, 333, 244, 244)
    pdf.setFont("Helvetica", 9)
    pdf.drawString(42, 290, "This records the uploaded proof. It does not independently verify a bank transfer.")
    pdf.drawString(42, 273, "Check the order page for the current payment and delivery status.")
    pdf.setFont("Helvetica", 8)
    pdf.drawString(42, 54, "The receiver QR and payer screenshot are private payment evidence.")
    pdf.showPage()
    pdf.setFont("Helvetica-Bold", 17)
    pdf.drawString(42, 785, "Payer screenshot")
    pdf.setFont("Helvetica", 10)
    pdf.drawString(42, 763, f"Order {order.order_number}  |  Payment attempt {payment.id}")
    pdf.rect(42, 50, 511, 695)
    _draw_image(pdf, payer_image, 49, 57, 497, 681)
    pdf.showPage()
    pdf.save()
    return output.getvalue()


def _receipt_bytes(db: Session, payment: PaymentAttempt) -> bytes:
    path = _receipt_path(payment)
    try:
        existing = read_private_payment_receipt(path)
    except FileNotFoundError:
        existing = None
    if existing is not None:
        if not _valid_receipt(existing):
            raise PaymentProofStorageError("Stored receipt is invalid.")
        return existing

    order = db.get(Order, payment.order_id)
    store = db.get(StoreSettings, 1)
    if order is None or store is None or not store.qr_code_storage_path:
        raise PaymentProofStorageError("The receiver QR is not available for this receipt.")
    screenshot, _ = read_private_payment_proof(payment.screenshot_storage_path)
    qr, _ = get_storage_object(settings.payment_qr_bucket, store.qr_code_storage_path)
    try:
        content = _build_receipt_pdf(payment, order, store, screenshot, qr)
    except (OSError, ValueError, Image.DecompressionBombError) as exc:
        raise PaymentProofStorageError("The payment images could not be prepared for a receipt.") from exc
    try:
        store_private_payment_receipt(path, content)
    except PaymentProofStorageError:
        # A concurrent download may have stored the same immutable receipt first.
        pass
    saved = read_private_payment_receipt(path)
    if not _valid_receipt(saved):
        raise PaymentProofStorageError("Stored receipt is invalid.")
    return saved


def archive_delivered_proofs(db: Session, order: Order) -> bool:
    """Delete each original only after the private PDF has been read back successfully."""
    complete = True
    attempts = db.scalars(select(PaymentAttempt).where(PaymentAttempt.order_id == order.id)).all()
    for payment in attempts:
        try:
            _receipt_bytes(db, payment)
            delete_private_payment_proof(payment.screenshot_storage_path)
        except (FileNotFoundError, CatalogImageStorageError, PaymentProofStorageError) as exc:
            complete = False
            logger.warning("Payment proof cleanup deferred for %s: %s", payment.id, exc)
    return complete


def _download_pdf(db: Session, payment: PaymentAttempt) -> Response:
    try:
        content = _receipt_bytes(db, payment)
    except (FileNotFoundError, CatalogImageStorageError, PaymentProofStorageError) as exc:
        raise HTTPException(status_code=503, detail="Payment receipt is temporarily unavailable. Please try again.") from exc
    order = db.get(Order, payment.order_id)
    return Response(content=content, media_type="application/pdf", headers={
        "Content-Disposition": f'attachment; filename="{_receipt_filename(order, payment)}"',
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
    })


@router.get("/payments/{order_id}/receipt")
def download_customer_receipt(order_id: str, principal: AuthenticatedPrincipal = Depends(get_current_principal),
                              db: Session = Depends(get_db)) -> Response:
    order = _resolve_order_by_id_or_number(db, order_id)
    if order is None:
        raise HTTPException(status_code=404, detail="Order not found.")
    if order.user_id != principal.id:
        raise HTTPException(status_code=403, detail="You can only download receipts for your own orders.")
    if not order.payment_attempts:
        raise HTTPException(status_code=404, detail="No payment proof has been submitted for this order.")
    return _download_pdf(db, order.payment_attempts[0])


@router.get("/admin/payments/{payment_id}/receipt")
def download_admin_receipt(payment_id: str, _admin: AuthenticatedPrincipal = Depends(get_owner_admin_principal),
                           db: Session = Depends(get_db)) -> Response:
    payment = db.get(PaymentAttempt, payment_id)
    if payment is None:
        raise HTTPException(status_code=404, detail="Payment submission not found.")
    return _download_pdf(db, payment)


@router.post("/admin/payments/{payment_id}/archive")
def retry_delivered_proof_cleanup(payment_id: str, _admin: AuthenticatedPrincipal = Depends(get_owner_admin_principal),
                                  db: Session = Depends(get_db)) -> dict[str, bool]:
    payment = db.get(PaymentAttempt, payment_id)
    if payment is None:
        raise HTTPException(status_code=404, detail="Payment submission not found.")
    order = db.get(Order, payment.order_id)
    if order is None or order.status != "DELIVERED":
        raise HTTPException(status_code=409, detail="Screenshot cleanup is available after delivery.")
    return {"complete": archive_delivered_proofs(db, order)}


class ReceiptSelection(BaseModel):
    payment_ids: list[str] = Field(alias="paymentIds", min_length=1, max_length=100)


@router.post("/admin/payments/receipts")
def download_admin_receipts(payload: ReceiptSelection,
                            _admin: AuthenticatedPrincipal = Depends(get_owner_admin_principal),
                            db: Session = Depends(get_db)) -> Response:
    archive = io.BytesIO()
    csv_file = io.StringIO()
    report = csv.writer(csv_file)
    report.writerow(["Order", "Payment attempt", "Status", "Amount (INR)", "Submitted at"])
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_STORED) as bundle:
        for payment_id in dict.fromkeys(payload.payment_ids):
            payment = db.get(PaymentAttempt, payment_id)
            if payment is None:
                raise HTTPException(status_code=404, detail="One selected payment submission was not found.")
            try:
                content = _receipt_bytes(db, payment)
            except (FileNotFoundError, CatalogImageStorageError, PaymentProofStorageError) as exc:
                raise HTTPException(status_code=503, detail="One selected receipt is unavailable. Please try again.") from exc
            order = db.get(Order, payment.order_id)
            bundle.writestr(_receipt_filename(order, payment), content)
            report.writerow([order.order_number, payment.id, payment.status,
                             f"{payment.expected_amount_paise / 100:.2f}", payment.submitted_at.isoformat()])
            if archive.tell() > MAX_ARCHIVE_BYTES:
                raise HTTPException(status_code=413, detail="Receipt archive is too large. Select fewer payments.")
        bundle.writestr("payment-report.csv", csv_file.getvalue().encode("utf-8-sig"))
    if archive.tell() > MAX_ARCHIVE_BYTES:
        raise HTTPException(status_code=413, detail="Receipt archive is too large. Select fewer payments.")
    return Response(content=archive.getvalue(), media_type="application/zip", headers={
        "Content-Disposition": 'attachment; filename="balaji-payment-receipts.zip"',
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
    })
