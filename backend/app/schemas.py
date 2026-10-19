"""Pydantic v2 request and response models for Balaji Faki Point FastAPI backend."""

from __future__ import annotations

from typing import Literal, Optional
from pydantic import BaseModel, ConfigDict, Field


class CamelModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")


class CheckoutQuoteRequestSchema(CamelModel):
    product: Literal["faki", "supari"]
    pack_size: Literal["250g", "500g", "1kg"] = Field(alias="packSize")
    quantity: int = Field(ge=1, le=20)
    pin_code: str = Field(alias="pinCode", min_length=6, max_length=6)


class CheckoutQuoteResponseSchema(CamelModel):
    subtotal: float | int
    delivery_fee: float | int = Field(alias="deliveryFee")
    total: float | int
    currency: Literal["INR"] = "INR"


class CreateOrderRequestSchema(CamelModel):
    product: Literal["faki", "supari"]
    pack_size: Literal["250g", "500g", "1kg"] = Field(alias="packSize")
    quantity: int = Field(ge=1, le=20)
    full_name: str = Field(alias="fullName", min_length=2, max_length=100)
    phone: str = Field(min_length=10, max_length=20)
    address: str = Field(min_length=10, max_length=500)
    pin_code: str = Field(alias="pinCode", min_length=6, max_length=6)


class PaymentInstructionsSchema(CamelModel):
    amount: float | int
    payee_name: str = Field(alias="payeeName")
    upi_id: str = Field(alias="upiId")
    qr_image_url: Optional[str] = Field(default=None, alias="qrImageUrl")
    expires_at: Optional[str] = Field(default=None, alias="expiresAt")


class OrderResponseSchema(CamelModel):
    id: str
    order_number: str = Field(alias="orderNumber")
    product: Literal["faki", "supari"]
    product_name: str = Field(alias="productName")
    product_image_url: Optional[str] = Field(default=None, alias="productImageUrl")
    pack_size: Literal["250g", "500g", "1kg"] = Field(alias="packSize")
    quantity: int
    subtotal: float | int
    delivery_fee: float | int = Field(alias="deliveryFee")
    total: float | int
    customer_name: str = Field(alias="customerName")
    phone: str
    address: str
    pin_code: str = Field(alias="pinCode")
    status: str
    payment_status: str = Field(alias="paymentStatus")
    utr_number: Optional[str] = Field(default=None, alias="utrNumber")
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")
    payment: Optional[PaymentInstructionsSchema] = None


class PaymentSubmissionResponseSchema(CamelModel):
    payment_id: str = Field(alias="paymentId")
    order_id: str = Field(alias="orderId")
    order_number: str = Field(alias="orderNumber")
    payment_status: str = Field(alias="paymentStatus")
    order_status: str = Field(alias="orderStatus")
    utr_masked: str = Field(alias="utrMasked")
    submitted_at: str = Field(alias="submittedAt")
    message: str


class PaymentStatusResponseSchema(CamelModel):
    order_id: str = Field(alias="orderId")
    order_number: str = Field(alias="orderNumber")
    status: str
    order_status: str = Field(alias="orderStatus")
    message: Optional[str] = None
    utr_masked: Optional[str] = Field(default=None, alias="utrMasked")


class ApprovePaymentRequestSchema(CamelModel):
    receiving_bank_account: str = Field(alias="receivingBankAccount", min_length=4, max_length=128)
    verified_amount: float = Field(alias="verifiedAmount", gt=0)
    verified_utr: str = Field(alias="verifiedUtr", min_length=12, max_length=12)
    transaction_status: str = Field(alias="transactionStatus")
    bank_credit_reference: str = Field(alias="bankCreditReference", min_length=4, max_length=128)
    evidence_kind: Literal["BANK_STATEMENT", "LOCAL_TEST"] = Field(default="BANK_STATEMENT", alias="evidenceKind")
    bank_statement_checked: bool = Field(default=False, alias="bankStatementChecked")
    notes: Optional[str] = None


class ReviewPaymentRequestSchema(CamelModel):
    notes: Optional[str] = Field(default=None, max_length=500)


class RejectPaymentRequestSchema(CamelModel):
    reason: str = Field(min_length=5, max_length=500)
    request_corrected_proof: bool = Field(default=False, alias="requestCorrectedProof")


class SubmitReviewRequestSchema(CamelModel):
    rating: int = Field(ge=1, le=5)
    review_text: str = Field(alias="reviewText", min_length=10, max_length=2000)


class UpdateAdminReviewRequestSchema(CamelModel):
    moderation_status: Optional[Literal["PUBLISHED", "HIDDEN", "PENDING_MODERATION"]] = Field(
        default=None, alias="moderationStatus"
    )
    admin_reply: Optional[str] = Field(default=None, alias="adminReply", max_length=2000)
    moderation_reason: Optional[str] = Field(default=None, alias="moderationReason", max_length=500)


class ConfirmOrderRequestSchema(CamelModel):
    notes: Optional[str] = None


class UpdateOrderStatusRequestSchema(CamelModel):
    status: str
    notes: Optional[str] = None
    cancellation_reason: Optional[str] = Field(default=None, alias="cancellationReason")
    failure_reason: Optional[str] = Field(default=None, alias="failureReason")


class CancelOrderRequestSchema(CamelModel):
    reason: str = Field(min_length=5, max_length=500)


class UpdateDeliveryRequestSchema(CamelModel):
    status: Optional[str] = None
    assigned_delivery_person: Optional[str] = Field(default=None, alias="assignedDeliveryPerson")
    delivery_phone: Optional[str] = Field(default=None, alias="deliveryPhone")
    courier_tracking_reference: Optional[str] = Field(default=None, alias="courierTrackingReference")
    dispatch_date: Optional[str] = Field(default=None, alias="dispatchDate")
    pickup_date: Optional[str] = Field(default=None, alias="pickupDate")
    estimated_delivery_date: Optional[str] = Field(default=None, alias="estimatedDeliveryDate")
    delivered_date: Optional[str] = Field(default=None, alias="deliveredDate")
    delivery_notes: Optional[str] = Field(default=None, alias="deliveryNotes")
    failure_reason: Optional[str] = Field(default=None, alias="failureReason")


class ApproveRefundRequestSchema(CamelModel):
    notes: Optional[str] = Field(default=None, max_length=500)


class RecordRefundTransferRequestSchema(CamelModel):
    refund_transaction_reference: str = Field(alias="refundTransactionReference", min_length=4, max_length=128)
    refund_bank_account: str = Field(alias="refundBankAccount", min_length=4, max_length=128)
    refund_date: str = Field(alias="refundDate", min_length=8, max_length=32)
    verified_amount: float = Field(alias="verifiedAmount", gt=0)
    notes: Optional[str] = Field(default=None, max_length=500)


class UpdateProductVariantInputSchema(CamelModel):
    id: Optional[str] = None
    pack_size: Literal["250g", "500g", "1kg"] = Field(alias="packSize")
    cost_price: Optional[float] = Field(default=None, alias="costPrice")
    price: Optional[float] = None
    available_quantity: Optional[int] = Field(default=None, alias="availableQuantity")
    is_available: Optional[bool] = Field(default=None, alias="isAvailable")
    price_confirmed: Optional[bool] = Field(default=None, alias="priceConfirmed")


class ProductInformationSchema(CamelModel):
    ingredients: Optional[str] = Field(default=None, max_length=2000)
    popularity: Optional[str] = Field(default=None, max_length=2000)
    characteristics: Optional[str] = Field(default=None, max_length=2000)
    production_packaging: Optional[str] = Field(default=None, alias="productionPackaging", max_length=2000)
    provider_manufacturer: Optional[str] = Field(default=None, alias="providerManufacturer", max_length=2000)
    safety_storage: Optional[str] = Field(default=None, alias="safetyStorage", max_length=2000)
    shelf_life: Optional[str] = Field(default=None, alias="shelfLife", max_length=2000)
    packaging: Optional[str] = Field(default=None, max_length=2000)
    safety_disclosures: Optional[str] = Field(default=None, alias="safetyDisclosures", max_length=2000)


class UpdateAdminProductRequestSchema(CamelModel):
    name: Optional[str] = None
    name_gu: Optional[str] = Field(default=None, alias="nameGu")
    category: Optional[str] = None
    description: Optional[str] = None
    description_gu: Optional[str] = Field(default=None, alias="descriptionGu")
    image_url: Optional[str] = Field(default=None, alias="imageUrl")
    active: Optional[bool] = None
    information: Optional[ProductInformationSchema] = None
    variants: Optional[list[UpdateProductVariantInputSchema]] = None


class LinkLegacyAccountRequestSchema(CamelModel):
    legacy_password: str = Field(alias="legacyPassword", min_length=4, max_length=128)


class StockAdjustmentRequestSchema(CamelModel):
    inventory_item_id: str = Field(alias="inventoryItemId", min_length=1, max_length=64)
    adjustment_type: Literal["ADD", "DEDUCT"] = Field(alias="adjustmentType")
    quantity: int = Field(ge=1, le=100000)
    reason: str = Field(min_length=5, max_length=500)


class UpdateAdminSettingsRequestSchema(CamelModel):
    """Partial update: only fields present in the request change."""

    store_name: Optional[str] = Field(default=None, alias="storeName", min_length=1, max_length=120)
    store_name_gu: Optional[str] = Field(default=None, alias="storeNameGu", max_length=120)
    tagline: Optional[str] = Field(default=None, max_length=255)
    store_address: Optional[str] = Field(default=None, alias="storeAddress", min_length=1, max_length=255)
    phone_number: Optional[str] = Field(default=None, alias="phoneNumber", min_length=5, max_length=32)
    support_whatsapp: Optional[str] = Field(default=None, alias="supportWhatsapp", max_length=32)
    support_email: Optional[str] = Field(default=None, alias="supportEmail", max_length=255)
    business_hours: Optional[str] = Field(default=None, alias="businessHours", min_length=1, max_length=120)
    shop_intro: Optional[str] = Field(default=None, alias="shopIntro", max_length=4000)
    production_info: Optional[str] = Field(default=None, alias="productionInfo", max_length=4000)
    provider_manufacturer: Optional[str] = Field(default=None, alias="providerManufacturer", max_length=4000)
    packaging_info: Optional[str] = Field(default=None, alias="packagingInfo", max_length=4000)
    official_upi_id: Optional[str] = Field(default=None, alias="officialUpiId", max_length=120)
    official_payee_name: Optional[str] = Field(default=None, alias="officialPayeeName", max_length=120)
    delivery_charges: Optional[float] = Field(default=None, alias="deliveryCharges", ge=0, le=100000)
    free_delivery_threshold: Optional[float] = Field(default=None, alias="freeDeliveryThreshold", ge=0, le=10000000)
    serviceable_pin_codes: Optional[list[str]] = Field(default=None, alias="serviceablePinCodes", max_length=200)
    low_stock_threshold: Optional[int] = Field(default=None, alias="lowStockThreshold", ge=0, le=100000)
    stock_reservation_expiry_minutes: Optional[int] = Field(
        default=None, alias="stockReservationExpiryMinutes", ge=1, le=10080
    )


class ConfirmBusinessSettingsRequestSchema(CamelModel):
    confirm: Literal[True]
    note: Optional[str] = Field(default=None, max_length=500)
