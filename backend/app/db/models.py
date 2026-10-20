"""SQLAlchemy 2.0 ORM models for the Neon PostgreSQL application schema."""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import (
    BigInteger,
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    JSON,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    TypeDecorator,
    Uuid,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


_NIL_UUID = "00000000-0000-0000-0000-000000000000"


class GUID(TypeDecorator):
    """UUID stored natively on PostgreSQL (CHAR on SQLite) and exposed as a string.

    A malformed identifier (for example a made-up id in a URL) is bound as the nil UUID, which matches no row, so lookups
    answer "not found" instead of raising a database error.
    """

    impl = Uuid(as_uuid=False)
    cache_ok = True

    def process_bind_param(self, value, dialect):  # noqa: ANN001
        if value is None:
            return None
        try:
            return str(uuid.UUID(str(value)))
        except ValueError:
            return _NIL_UUID



class JSONText(TypeDecorator):
    """JSON stored as jsonb on PostgreSQL and as text on SQLite; the application always reads and writes a JSON string."""

    impl = Text
    cache_ok = True

    def load_dialect_impl(self, dialect):  # noqa: ANN001
        return dialect.type_descriptor(JSONB()) if dialect.name == "postgresql" else dialect.type_descriptor(Text())

    def process_bind_param(self, value, dialect):  # noqa: ANN001
        if value is None or dialect.name != "postgresql":
            return value
        try:
            return json.loads(value)
        except (TypeError, ValueError):
            return value  # not JSON text: stored as a JSON string

    def process_result_value(self, value, dialect):  # noqa: ANN001
        if value is None or isinstance(value, str) and dialect.name != "postgresql":
            return value
        return json.dumps(value)



class ISOText(TypeDecorator):
    """ISO date/time text in the application; a real timestamptz (or date) column on PostgreSQL.

    Accepts "2026-10-19" or a full ISO timestamp from the admin UI; unparsable text is rejected with a ValueError
    that the API reports as a validation error.
    """

    impl = String(64)
    cache_ok = True

    def __init__(self, *, date_only: bool = False) -> None:
        super().__init__()
        self.date_only = date_only

    def load_dialect_impl(self, dialect):  # noqa: ANN001
        if dialect.name != "postgresql":
            return dialect.type_descriptor(String(64))
        return dialect.type_descriptor(Date() if self.date_only else DateTime(timezone=True))

    def process_bind_param(self, value, dialect):  # noqa: ANN001
        if value is None or dialect.name != "postgresql":
            return value
        text = str(value).strip().replace("Z", "+00:00")
        try:
            parsed = datetime.fromisoformat(text)
        except ValueError as exc:
            raise ValueError(f"Invalid date or time: {value!r}") from exc
        if self.date_only:
            return parsed.date()
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)

    def process_result_value(self, value, dialect):  # noqa: ANN001
        if value is None or isinstance(value, str):
            return value
        return value.isoformat()



def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def new_uuid_str() -> str:
    return str(uuid.uuid4())


class Base(DeclarativeBase):
    pass


class UserProfile(Base):
    __tablename__ = "user_profiles"

    id: Mapped[str] = mapped_column(GUID(), primary_key=True, default=new_uuid_str)
    auth_subject: Mapped[Optional[str]] = mapped_column(Text, nullable=True, unique=True)
    email: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    full_name: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    phone: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    role: Mapped[str] = mapped_column(String(32), nullable=False, default="CUSTOMER")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow
    )


class Customer(Base):
    __tablename__ = "customers"

    id: Mapped[str] = mapped_column(GUID(), primary_key=True, default=new_uuid_str)
    user_id: Mapped[Optional[str]] = mapped_column(
        GUID(), ForeignKey("user_profiles.id", ondelete="SET NULL"), unique=True, nullable=True, index=True
    )
    full_name: Mapped[str] = mapped_column(String(120), nullable=False)
    phone: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    area: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    address: Mapped[str] = mapped_column(Text, nullable=False, default="")
    pin_code: Mapped[str] = mapped_column(String(12), nullable=False, default="")
    order_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_spent_paise: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    last_order_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow
    )


class Product(Base):
    __tablename__ = "products"

    id: Mapped[str] = mapped_column(GUID(), primary_key=True, default=new_uuid_str)
    slug: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    name_gu: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    category: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    ingredients: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    popularity: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    characteristics: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    production_packaging: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    provider_manufacturer: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    safety_storage: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    shelf_life: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    packaging: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    safety_disclosures: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    image_url: Mapped[str] = mapped_column(String(512), nullable=False, default="")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    # Typed amounts (100 g to 10 kg) of a weight product are priced per kg; None = not offered.
    price_per_kg_paise: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    cost_per_kg_paise: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow
    )

    variants: Mapped[list["ProductVariant"]] = relationship(
        "ProductVariant", back_populates="product", cascade="all, delete-orphan", order_by="ProductVariant.pack_size"
    )
    images: Mapped[list["ProductImage"]] = relationship(
        "ProductImage", back_populates="product", cascade="all, delete-orphan", order_by="ProductImage.position"
    )


class ProductImage(Base):
    __tablename__ = "product_images"
    __table_args__ = (UniqueConstraint("product_id", "position", name="product_images_product_id_position_key"),)

    id: Mapped[str] = mapped_column(GUID(), primary_key=True, default=new_uuid_str)
    product_id: Mapped[str] = mapped_column(
        GUID(), ForeignKey("products.id", ondelete="CASCADE"), nullable=False, index=True
    )
    storage_path: Mapped[str] = mapped_column(String(512), unique=True, nullable=False)
    alt_text: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    position: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)

    product: Mapped["Product"] = relationship("Product", back_populates="images")


class StorePhoto(Base):
    __tablename__ = "store_photos"

    id: Mapped[str] = mapped_column(GUID(), primary_key=True, default=new_uuid_str)
    storage_path: Mapped[str] = mapped_column(String(512), unique=True, nullable=False)
    caption: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    position: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0, unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)


class ProductVariant(Base):
    __tablename__ = "product_variants"
    __table_args__ = (UniqueConstraint("product_id", "pack_size", name="uq_product_variants_product_pack"),)

    id: Mapped[str] = mapped_column(GUID(), primary_key=True, default=new_uuid_str)
    product_id: Mapped[str] = mapped_column(
        GUID(), ForeignKey("products.id", ondelete="CASCADE"), nullable=False, index=True
    )
    pack_size: Mapped[str] = mapped_column(String(16), nullable=False)
    sku: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    cost_price_paise: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    price_paise: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    price_confirmed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_available: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    total_stock: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    reserved_stock: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    low_stock_threshold: Mapped[int] = mapped_column(Integer, nullable=False, default=10)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow
    )

    product: Mapped["Product"] = relationship("Product", back_populates="variants")

    @property
    def available_stock(self) -> int:
        return max(0, int(self.total_stock) - int(self.reserved_stock))


class Order(Base):
    __tablename__ = "orders"

    id: Mapped[str] = mapped_column(GUID(), primary_key=True, default=new_uuid_str)
    order_number: Mapped[str] = mapped_column(String(32), unique=True, nullable=False, index=True)
    user_id: Mapped[str] = mapped_column(
        GUID(), ForeignKey("user_profiles.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    customer_id: Mapped[str] = mapped_column(
        GUID(), ForeignKey("customers.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="PENDING_PAYMENT", index=True)
    payment_status: Mapped[str] = mapped_column(String(32), nullable=False, default="PENDING", index=True)
    delivery_status: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    subtotal_paise: Mapped[int] = mapped_column(BigInteger, nullable=False)
    delivery_fee_paise: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    total_paise: Mapped[int] = mapped_column(BigInteger, nullable=False)
    shipping_name: Mapped[str] = mapped_column(String(120), nullable=False)
    shipping_phone: Mapped[str] = mapped_column(String(32), nullable=False)
    shipping_email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    shipping_address: Mapped[str] = mapped_column(Text, nullable=False)
    shipping_area: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    shipping_pin_code: Mapped[str] = mapped_column(String(12), nullable=False)
    customer_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    idempotency_key: Mapped[Optional[str]] = mapped_column(String(128), unique=True, nullable=True)
    stock_reservation_expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    stock_deducted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    confirmed_by: Mapped[Optional[str]] = mapped_column(
        GUID(), ForeignKey("user_profiles.id", ondelete="SET NULL"), nullable=True
    )
    confirmed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    cancelled_by: Mapped[Optional[str]] = mapped_column(
        GUID(), ForeignKey("user_profiles.id", ondelete="SET NULL"), nullable=True
    )
    cancelled_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    cancellation_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow
    )

    items: Mapped[list["OrderItem"]] = relationship(
        "OrderItem", back_populates="order", cascade="all, delete-orphan"
    )
    status_history: Mapped[list["OrderStatusHistory"]] = relationship(
        "OrderStatusHistory",
        back_populates="order",
        cascade="all, delete-orphan",
        order_by="OrderStatusHistory.created_at",
    )
    payment_attempts: Mapped[list["PaymentAttempt"]] = relationship(
        "PaymentAttempt",
        back_populates="order",
        order_by="PaymentAttempt.submitted_at.desc()",
    )
    shipment: Mapped[Optional["Shipment"]] = relationship(
        "Shipment", back_populates="order", uselist=False, cascade="all, delete-orphan"
    )


class OrderItem(Base):
    __tablename__ = "order_items"

    id: Mapped[str] = mapped_column(GUID(), primary_key=True, default=new_uuid_str)
    order_id: Mapped[str] = mapped_column(
        GUID(), ForeignKey("orders.id", ondelete="CASCADE"), nullable=False, index=True
    )
    product_id: Mapped[str] = mapped_column(
        GUID(), ForeignKey("products.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    # None for a typed amount (weighed to order, priced per kg, no stock reserved or deducted).
    variant_id: Mapped[Optional[str]] = mapped_column(
        GUID(), ForeignKey("product_variants.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    product_slug: Mapped[str] = mapped_column(String(32), nullable=False)
    product_name: Mapped[str] = mapped_column(String(120), nullable=False)
    pack_size: Mapped[str] = mapped_column(String(16), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    unit_cost_paise: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    unit_price_paise: Mapped[int] = mapped_column(BigInteger, nullable=False)
    line_total_paise: Mapped[int] = mapped_column(BigInteger, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)

    order: Mapped["Order"] = relationship("Order", back_populates="items")


class PaymentAttempt(Base):
    __tablename__ = "payment_attempts"
    __table_args__ = (
        Index("payment_attempts_verified_utr_idx", "verified_utr"),
    )

    id: Mapped[str] = mapped_column(GUID(), primary_key=True, default=new_uuid_str)
    order_id: Mapped[str] = mapped_column(
        GUID(), ForeignKey("orders.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    user_id: Mapped[str] = mapped_column(
        GUID(), ForeignKey("user_profiles.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    expected_amount_paise: Mapped[int] = mapped_column(BigInteger, nullable=False)
    submitted_utr: Mapped[Optional[str]] = mapped_column(String(12), nullable=True)
    verified_utr: Mapped[Optional[str]] = mapped_column(String(12), nullable=True)
    screenshot_storage_path: Mapped[str] = mapped_column(String(512), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="SUBMITTED", index=True)
    proof_correction_requested: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    idempotency_key: Mapped[Optional[str]] = mapped_column(String(128), unique=True, nullable=True)
    verified_by: Mapped[Optional[str]] = mapped_column(
        GUID(), ForeignKey("user_profiles.id", ondelete="SET NULL"), nullable=True
    )
    verified_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    rejection_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    admin_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow
    )

    order: Mapped["Order"] = relationship("Order", back_populates="payment_attempts")
    bank_credit: Mapped[Optional["BankCredit"]] = relationship(
        "BankCredit", back_populates="payment_attempt", uselist=False
    )


class BankCredit(Base):
    __tablename__ = "bank_credits"

    id: Mapped[str] = mapped_column(GUID(), primary_key=True, default=new_uuid_str)
    payment_attempt_id: Mapped[str] = mapped_column(
        GUID(), ForeignKey("payment_attempts.id", ondelete="RESTRICT"), unique=True, nullable=False
    )
    order_id: Mapped[str] = mapped_column(
        GUID(), ForeignKey("orders.id", ondelete="RESTRICT"), unique=True, nullable=False
    )
    bank_credit_ref: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    receiving_bank_account: Mapped[str] = mapped_column(String(128), nullable=False)
    verified_utr: Mapped[str] = mapped_column(String(12), unique=True, nullable=False)
    credited_amount_paise: Mapped[int] = mapped_column(BigInteger, nullable=False)
    transaction_status: Mapped[str] = mapped_column(String(32), nullable=False, default="CREDITED")
    verified_by: Mapped[str] = mapped_column(
        GUID(), ForeignKey("user_profiles.id", ondelete="RESTRICT"), nullable=False
    )
    verified_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    verification_note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    evidence_kind: Mapped[str] = mapped_column(String(32), nullable=False, default="BANK_STATEMENT")

    payment_attempt: Mapped["PaymentAttempt"] = relationship("PaymentAttempt", back_populates="bank_credit")


class OrderStatusHistory(Base):
    __tablename__ = "order_status_history"

    id: Mapped[str] = mapped_column(GUID(), primary_key=True, default=new_uuid_str)
    order_id: Mapped[str] = mapped_column(
        GUID(), ForeignKey("orders.id", ondelete="CASCADE"), nullable=False, index=True
    )
    from_status: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    to_status: Mapped[str] = mapped_column(String(32), nullable=False)
    actor_id: Mapped[Optional[str]] = mapped_column(
        GUID(), ForeignKey("user_profiles.id", ondelete="SET NULL"), nullable=True
    )
    actor_name: Mapped[str] = mapped_column(String(120), nullable=False)
    actor_role: Mapped[str] = mapped_column(String(32), nullable=False)
    note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)

    order: Mapped["Order"] = relationship("Order", back_populates="status_history")


class InventoryMovement(Base):
    __tablename__ = "inventory_movements"

    id: Mapped[str] = mapped_column(GUID(), primary_key=True, default=new_uuid_str)
    variant_id: Mapped[str] = mapped_column(
        GUID(), ForeignKey("product_variants.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    movement_type: Mapped[str] = mapped_column(String(32), nullable=False)
    quantity_delta: Mapped[int] = mapped_column(Integer, nullable=False)
    previous_available: Mapped[int] = mapped_column(Integer, nullable=False)
    new_available: Mapped[int] = mapped_column(Integer, nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    reference_order_id: Mapped[Optional[str]] = mapped_column(
        GUID(), ForeignKey("orders.id", ondelete="SET NULL"), nullable=True
    )
    actor_id: Mapped[Optional[str]] = mapped_column(
        GUID(), ForeignKey("user_profiles.id", ondelete="SET NULL"), nullable=True
    )
    actor_name: Mapped[str] = mapped_column(String(120), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)


class Shipment(Base):
    __tablename__ = "shipments"

    id: Mapped[str] = mapped_column(GUID(), primary_key=True, default=new_uuid_str)
    order_id: Mapped[str] = mapped_column(
        GUID(), ForeignKey("orders.id", ondelete="CASCADE"), unique=True, nullable=False, index=True
    )
    delivery_status: Mapped[str] = mapped_column(String(32), nullable=False, default="CONFIRMED", index=True)
    assigned_delivery_person: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    delivery_phone: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    courier_reference: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    dispatch_date: Mapped[Optional[str]] = mapped_column(ISOText(), nullable=True)
    pickup_date: Mapped[Optional[str]] = mapped_column(ISOText(), nullable=True)
    estimated_delivery_date: Mapped[Optional[str]] = mapped_column(ISOText(), nullable=True)
    delivered_date: Mapped[Optional[str]] = mapped_column(ISOText(), nullable=True)
    delivery_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    failure_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow
    )

    order: Mapped["Order"] = relationship("Order", back_populates="shipment")
    events: Mapped[list["DeliveryEvent"]] = relationship(
        "DeliveryEvent",
        back_populates="shipment",
        cascade="all, delete-orphan",
        order_by="DeliveryEvent.created_at",
    )


class DeliveryEvent(Base):
    __tablename__ = "delivery_events"

    id: Mapped[str] = mapped_column(GUID(), primary_key=True, default=new_uuid_str)
    shipment_id: Mapped[str] = mapped_column(
        GUID(), ForeignKey("shipments.id", ondelete="CASCADE"), nullable=False, index=True
    )
    order_id: Mapped[str] = mapped_column(
        GUID(), ForeignKey("orders.id", ondelete="CASCADE"), nullable=False, index=True
    )
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    label: Mapped[str] = mapped_column(String(120), nullable=False)
    note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    actor_id: Mapped[Optional[str]] = mapped_column(
        GUID(), ForeignKey("user_profiles.id", ondelete="SET NULL"), nullable=True
    )
    actor_name: Mapped[str] = mapped_column(String(120), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)

    shipment: Mapped["Shipment"] = relationship("Shipment", back_populates="events")


class Review(Base):
    __tablename__ = "reviews"

    id: Mapped[str] = mapped_column(GUID(), primary_key=True, default=new_uuid_str)
    order_id: Mapped[str] = mapped_column(
        GUID(), ForeignKey("orders.id", ondelete="RESTRICT"), unique=True, nullable=False
    )
    customer_id: Mapped[str] = mapped_column(
        GUID(), ForeignKey("customers.id", ondelete="RESTRICT"), nullable=False
    )
    user_id: Mapped[str] = mapped_column(
        GUID(), ForeignKey("user_profiles.id", ondelete="RESTRICT"), nullable=False
    )
    product_id: Mapped[str] = mapped_column(
        GUID(), ForeignKey("products.id", ondelete="RESTRICT"), nullable=False
    )
    rating: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    review_text: Mapped[str] = mapped_column(Text, nullable=False)
    is_verified_purchase: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    moderation_status: Mapped[str] = mapped_column(String(32), nullable=False, default="PUBLISHED")
    moderation_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    admin_reply: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    admin_replied_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    moderated_by: Mapped[Optional[str]] = mapped_column(
        GUID(), ForeignKey("user_profiles.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow
    )
    photos: Mapped[list["ReviewPhoto"]] = relationship(
        "ReviewPhoto",
        back_populates="review",
        cascade="all, delete-orphan",
        order_by="ReviewPhoto.position",
    )


class ReviewPhoto(Base):
    __tablename__ = "review_photos"
    __table_args__ = (UniqueConstraint("review_id", "position", name="review_photos_review_position_key"),)

    id: Mapped[str] = mapped_column(GUID(), primary_key=True, default=new_uuid_str)
    review_id: Mapped[str] = mapped_column(
        GUID(), ForeignKey("reviews.id", ondelete="CASCADE"), nullable=False, index=True
    )
    storage_path: Mapped[str] = mapped_column(String(512), unique=True, nullable=False)
    mime_type: Mapped[str] = mapped_column(String(64), nullable=False)
    position: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)

    review: Mapped["Review"] = relationship("Review", back_populates="photos")


class Refund(Base):
    __tablename__ = "refunds"

    id: Mapped[str] = mapped_column(GUID(), primary_key=True, default=new_uuid_str)
    order_id: Mapped[str] = mapped_column(
        GUID(), ForeignKey("orders.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    original_payment_id: Mapped[str] = mapped_column(
        GUID(), ForeignKey("payment_attempts.id", ondelete="RESTRICT"), nullable=False
    )
    original_payment_utr: Mapped[Optional[str]] = mapped_column(String(12), nullable=True)
    refund_amount_paise: Mapped[int] = mapped_column(BigInteger, nullable=False)
    verified_refund_amount_paise: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    refund_reason: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="PENDING")
    refund_transaction_reference: Mapped[Optional[str]] = mapped_column(String(128), unique=True, nullable=True)
    refund_bank_account: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    refund_date: Mapped[Optional[str]] = mapped_column(ISOText(date_only=True), nullable=True)
    verified_by: Mapped[Optional[str]] = mapped_column(
        GUID(), ForeignKey("user_profiles.id", ondelete="SET NULL"), nullable=True
    )
    verified_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow
    )


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[str] = mapped_column(GUID(), primary_key=True, default=new_uuid_str)
    order_id: Mapped[Optional[str]] = mapped_column(
        GUID(), ForeignKey("orders.id", ondelete="SET NULL"), nullable=True, index=True
    )
    customer_id: Mapped[Optional[str]] = mapped_column(
        GUID(), ForeignKey("customers.id", ondelete="SET NULL"), nullable=True
    )
    user_id: Mapped[Optional[str]] = mapped_column(
        GUID(), ForeignKey("user_profiles.id", ondelete="SET NULL"), nullable=True
    )
    event_type: Mapped[str] = mapped_column(String(64), nullable=False)
    channel: Mapped[str] = mapped_column(String(32), nullable=False, default="IN_APP")
    recipient: Mapped[str] = mapped_column(String(255), nullable=False)
    subject: Mapped[str] = mapped_column(String(255), nullable=False)
    message_preview: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="SENT")
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    sent_by: Mapped[Optional[str]] = mapped_column(
        GUID(), ForeignKey("user_profiles.id", ondelete="SET NULL"), nullable=True
    )
    sent_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)


class StoreSettings(Base):
    __tablename__ = "store_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    store_name: Mapped[str] = mapped_column(String(120), nullable=False, default="Balaji Faki Point")
    store_name_gu: Mapped[str] = mapped_column(String(120), nullable=False, default="બાલાજી ફાકી પોઈન્ટ")
    tagline: Mapped[str] = mapped_column(String(255), nullable=False, default="Freshly Prepared Faki & Supari")
    support_phone: Mapped[str] = mapped_column(String(32), nullable=False, default="+91 80009 61030")
    support_whatsapp: Mapped[str] = mapped_column(String(32), nullable=False, default="918000961030")
    support_email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    store_address: Mapped[str] = mapped_column(String(255), nullable=False, default="Rajkot, Gujarat")
    opening_hours: Mapped[str] = mapped_column(
        String(120), nullable=False, default="Call the store to confirm opening hours"
    )
    shop_intro: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    production_info: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    provider_manufacturer: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    packaging_info: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    upi_payee_name: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    upi_id: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    qr_code_storage_path: Mapped[Optional[str]] = mapped_column(
        String(512), nullable=True
    )
    delivery_charge_paise: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True, default=0)
    free_delivery_threshold_paise: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True, default=0)
    # JSON on SQLite, jsonb on PostgreSQL: always a Python list of PIN strings.
    serviceable_pin_codes: Mapped[list] = mapped_column(
        JSON().with_variant(JSONB(), "postgresql"),
        nullable=False,
        default=list,
    )
    low_stock_default_threshold: Mapped[int] = mapped_column(Integer, nullable=False, default=10)
    stock_reservation_expiry_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=30)
    business_settings_confirmed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    business_settings_confirmed_by: Mapped[Optional[str]] = mapped_column(
        GUID(), ForeignKey("user_profiles.id", ondelete="SET NULL"), nullable=True
    )
    updated_by: Mapped[Optional[str]] = mapped_column(
        GUID(), ForeignKey("user_profiles.id", ondelete="SET NULL"), nullable=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow
    )


class AdminAuditLog(Base):
    __tablename__ = "admin_audit_logs"

    id: Mapped[str] = mapped_column(GUID(), primary_key=True, default=new_uuid_str)
    actor_id: Mapped[Optional[str]] = mapped_column(
        GUID(), ForeignKey("user_profiles.id", ondelete="SET NULL"), nullable=True
    )
    actor_email: Mapped[str] = mapped_column(String(255), nullable=False)
    actor_role: Mapped[str] = mapped_column(String(32), nullable=False, default="OWNER_ADMIN")
    action: Mapped[str] = mapped_column(String(120), nullable=False)
    module: Mapped[str] = mapped_column(String(64), nullable=False)
    entity_type: Mapped[str] = mapped_column(String(64), nullable=False)
    entity_id: Mapped[str] = mapped_column(String(64), nullable=False)
    previous_state: Mapped[Optional[str]] = mapped_column(JSONText(), nullable=True)
    new_state: Mapped[Optional[str]] = mapped_column(JSONText(), nullable=True)
    ip_address: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    idempotency_key: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
