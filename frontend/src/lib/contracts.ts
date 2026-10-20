import type { CheckoutQuote, Order, Product, PaymentStatusResponse, TrackingEvent } from '../types/orders';
import { PACK_SIZE_PATTERN, PRODUCT_SLUG_PATTERN } from '../constants/store';

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}
const money = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value >= 0 &&
  Number.isSafeInteger(Math.round(value * 100)) &&
  Math.abs(value * 100 - Math.round(value * 100)) < 0.000001;
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const productSlug = (value: unknown): boolean => typeof value === 'string' && PRODUCT_SLUG_PATTERN.test(value);
const packSize = (value: unknown): boolean => typeof value === 'string' && PACK_SIZE_PATTERN.test(value);
const productInformationKeys = [
  'ingredients',
  'popularity',
  'characteristics',
  'productionPackaging',
  'providerManufacturer',
  'safetyStorage',
];
const paymentStatuses = [
  'PENDING',
  'SUBMITTED',
  'UNDER_REVIEW',
  'VERIFIED',
  'REJECTED',
  'pending',
  'verifying',
  'verified',
  'failed',
];
const orderStatuses = [
  'PENDING_PAYMENT',
  'PAYMENT_REVIEW',
  'AWAITING_CONFIRMATION',
  'CONFIRMED',
  'PACKING',
  'PACKED',
  'PICKED_UP',
  'SHIPPED',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'CANCELLED',
  'DELIVERY_FAILED',
  'pending_payment',
  'verifying_payment',
  'active',
  'packing',
  'dispatched',
  'out_for_delivery',
  'delivered',
];

function totals(value: Record<string, unknown>) {
  return (
    money(value.subtotal) &&
    money(value.deliveryFee) &&
    money(value.total) &&
    Math.abs(value.total - value.subtotal - value.deliveryFee) < 0.01
  );
}
function invalid(): never {
  throw new Error('The server returned incomplete order or payment information. Please contact the store before paying.');
}

const optionalProductInformationKeys = ['shelfLife', 'packaging', 'safetyDisclosures'] as const;

function productInformation(value: unknown): boolean {
  return (
    record(value) &&
    productInformationKeys.every((key) => typeof value[key] === 'string') &&
    optionalProductInformationKeys.every((key) => value[key] === undefined || typeof value[key] === 'string')
  );
}

function productImages(value: unknown): boolean {
  return (
    value === undefined ||
    (Array.isArray(value) &&
      value.every((image) => record(image) && text(image.id) && text(image.url) && typeof image.alt === 'string'))
  );
}

export function readQuote(value: unknown): CheckoutQuote {
  if (!record(value) || !totals(value) || value.currency !== 'INR') return invalid();
  return value as unknown as CheckoutQuote;
}

export function readProducts(value: unknown): Product[] {
  if (!Array.isArray(value)) return invalid();
  for (const product of value) {
    if (
      !record(product) ||
      !productSlug(product.type) ||
      !text(product.name) ||
      typeof product.nameGu !== 'string' ||
      (product.category !== undefined && typeof product.category !== 'string') ||
      (product.description !== undefined && typeof product.description !== 'string') ||
      (product.imageUrl !== undefined && typeof product.imageUrl !== 'string') ||
      (product.information !== undefined && !productInformation(product.information)) ||
      !productImages(product.images) ||
      (product.averageRating !== undefined && product.averageRating !== null && typeof product.averageRating !== 'number') ||
      (product.reviewCount !== undefined && typeof product.reviewCount !== 'number') ||
      (product.pricePerKg !== undefined && product.pricePerKg !== null && !money(product.pricePerKg)) ||
      !Array.isArray(product.packSizes) ||
      !product.packSizes.length ||
      !record(product.prices)
    ) {
      return invalid();
    }
    const prices = product.prices;
    if (
      !product.packSizes.every(
        (size: unknown) =>
          typeof size === 'string' &&
          packSize(size) &&
          (prices[size] === null || money(prices[size])),
      )
    ) {
      return invalid();
    }
  }
  return value as Product[];
}

export function readOrder(value: unknown): Order {
  if (
    !record(value) ||
    !text(value.id) ||
    !text(value.orderNumber) ||
    !totals(value) ||
    !productSlug(value.product) ||
    !text(value.productName) ||
    !packSize(value.packSize) ||
    typeof value.quantity !== 'number' ||
    !Number.isInteger(value.quantity) ||
    value.quantity < 1 ||
    !['customerName', 'phone', 'address', 'pinCode', 'createdAt', 'updatedAt'].every((key) => text(value[key])) ||
    !paymentStatuses.includes(String(value.paymentStatus)) ||
    !orderStatuses.includes(String(value.status))
  ) {
    return invalid();
  }
  if (value.productImageUrl !== undefined && value.productImageUrl !== null && typeof value.productImageUrl !== 'string') {
    return invalid();
  }
  if (value.payment !== undefined && value.payment !== null) {
    const payment = value.payment;
    if (!record(payment) || payment.amount !== value.total || !text(payment.upiId) || !text(payment.payeeName)) {
      return invalid();
    }
    if (
      payment.expiresAt !== undefined &&
      payment.expiresAt !== null &&
      (typeof payment.expiresAt !== 'string' || !Number.isFinite(Date.parse(payment.expiresAt)))
    ) {
      return invalid();
    }
    if (payment.qrImageUrl !== undefined && payment.qrImageUrl !== null) {
      if (typeof payment.qrImageUrl !== 'string') return invalid();
      // The shop QR is served by FastAPI as a short-lived signed path; absolute http(s) URLs are also accepted.
      if (!/^\/api\/[A-Za-z0-9/_.-]+\?[A-Za-z0-9=&%._-]*$/.test(payment.qrImageUrl)) {
        try {
          if (!['https:', 'http:'].includes(new URL(payment.qrImageUrl).protocol)) return invalid();
        } catch {
          return invalid();
        }
      }
    }
    if (payment.settingsConfirmed !== undefined && typeof payment.settingsConfirmed !== 'boolean') return invalid();
  }
  return value as unknown as Order;
}

export function readPaymentStatus(value: unknown, orderId: string): PaymentStatusResponse {
  if (
    !record(value) ||
    value.orderId !== orderId ||
    !text(value.orderNumber) ||
    !paymentStatuses.includes(String(value.status)) ||
    !orderStatuses.includes(String(value.orderStatus))
  ) {
    return invalid();
  }
  if (value.message !== undefined && value.message !== null && typeof value.message !== 'string') {
    return invalid();
  }
  if (value.rejectionReason !== undefined && value.rejectionReason !== null && typeof value.rejectionReason !== 'string') {
    return invalid();
  }
  if (value.canSubmitProof !== undefined && typeof value.canSubmitProof !== 'boolean') {
    return invalid();
  }
  if (
    value.attempts !== undefined &&
    (!Array.isArray(value.attempts) || !value.attempts.every((attempt) => record(attempt) && text(attempt.id) && text(attempt.status)))
  ) {
    return invalid();
  }
  return value as unknown as PaymentStatusResponse;
}

export function readTracking(value: unknown): { events: TrackingEvent[] } {
  if (
    !record(value) ||
    !Array.isArray(value.events) ||
    !value.events.every(
      (event) =>
        record(event) &&
        text(event.status) &&
        text(event.label) &&
        text(event.timestamp) &&
        Number.isFinite(Date.parse(event.timestamp)) &&
        typeof event.description === 'string',
    )
  ) {
    return invalid();
  }
  return value as unknown as { events: TrackingEvent[] };
}
