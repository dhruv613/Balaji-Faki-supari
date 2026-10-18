import type { CheckoutQuote, Order, Product, PaymentStatusResponse, TrackingEvent } from '../types/orders';

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
const products = ['faki', 'supari'];
const sizes = ['250g', '500g', '1kg'];
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

export function readQuote(value: unknown): CheckoutQuote {
  if (!record(value) || !totals(value) || value.currency !== 'INR') return invalid();
  return value as unknown as CheckoutQuote;
}

export function readProducts(value: unknown): Product[] {
  if (!Array.isArray(value)) return invalid();
  for (const product of value) {
    if (
      !record(product) ||
      !products.includes(String(product.type)) ||
      !text(product.name) ||
      typeof product.nameGu !== 'string' ||
      (product.category !== undefined && typeof product.category !== 'string') ||
      (product.description !== undefined && typeof product.description !== 'string') ||
      (product.imageUrl !== undefined && typeof product.imageUrl !== 'string') ||
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
          sizes.includes(size) &&
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
    !products.includes(String(value.product)) ||
    !text(value.productName) ||
    !sizes.includes(String(value.packSize)) ||
    typeof value.quantity !== 'number' ||
    !Number.isInteger(value.quantity) ||
    value.quantity < 1 ||
    !['customerName', 'phone', 'address', 'pinCode', 'createdAt', 'updatedAt'].every((key) => text(value[key])) ||
    !paymentStatuses.includes(String(value.paymentStatus)) ||
    !orderStatuses.includes(String(value.status))
  ) {
    return invalid();
  }
  if (value.utrNumber !== undefined && value.utrNumber !== null && typeof value.utrNumber !== 'string') {
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
      try {
        if (!['https:', 'http:'].includes(new URL(payment.qrImageUrl).protocol)) return invalid();
      } catch {
        return invalid();
      }
    }
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
  if (value.utrMasked !== undefined && value.utrMasked !== null && typeof value.utrMasked !== 'string') {
    return invalid();
  }
  if (value.message !== undefined && value.message !== null && typeof value.message !== 'string') {
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
