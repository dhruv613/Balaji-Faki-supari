/**
 * Orders API — typed functions for FastAPI integration.
 *
 * All amounts, order IDs and statuses are produced by the server.
 * React only sends customer input and renders the server's response.
 */

import { readOrder, readQuote, readTracking } from '../../../lib/contracts';
import { apiFetch } from '../../../lib/api';
import type {
  CheckoutQuote,
  CheckoutQuoteRequest,
  Order,
  OrderFormData,
  TrackingEvent,
} from '../../../types/orders';

export interface SavedAddress { address: string; pinCode: string }

function readSavedAddress(value: unknown): SavedAddress {
  if (!value || typeof value !== 'object' ||
      !('address' in value) || typeof value.address !== 'string' ||
      !('pinCode' in value) || typeof value.pinCode !== 'string') {
    throw new Error('The server returned an unreadable saved address.');
  }
  return { address: value.address, pinCode: value.pinCode };
}

/** The signed-in customer's saved addresses and previous order addresses. */
export async function getSavedAddresses(): Promise<SavedAddress[]> {
  const response: unknown = await apiFetch<unknown>('/me/addresses');
  if (!response || typeof response !== 'object' || !('items' in response) || !Array.isArray(response.items)) {
    throw new Error('The server returned an unreadable address list.');
  }
  return response.items.map(readSavedAddress);
}

export async function saveAddress(address: SavedAddress): Promise<SavedAddress> {
  return readSavedAddress(await apiFetch<unknown>('/me/addresses', {
    method: 'POST',
    body: JSON.stringify(address),
  }));
}

/** POST /checkout/quote — server-calculated subtotal, delivery fee and total */
export async function getCheckoutQuote(req: CheckoutQuoteRequest): Promise<CheckoutQuote> {
  return readQuote(await apiFetch<unknown>('/checkout/quote', {
    method: 'POST',
    body: JSON.stringify(req),
  }));
}

/**
 * POST /orders — create a new order.
 * The response includes the real order ID, server-calculated totals and
 * the official payment instructions (UPI / QR) for this order.
 */
export async function createOrder(data: OrderFormData, idempotencyKey: string): Promise<Order> {
  return readOrder(await apiFetch<unknown>('/orders', {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(data),
  }));
}

/** GET /orders/:id — fetch a single order */
export async function getOrder(orderId: string): Promise<Order> {
  return readOrder(await apiFetch<unknown>(`/orders/${encodeURIComponent(orderId)}`));
}

/** GET /orders?phone= — fetch the customer's orders (phone or auth session) */
export async function getMyOrders(): Promise<Order[]> {
  const data = await apiFetch<unknown>('/orders');
  if (!Array.isArray(data)) throw new Error('The server returned an unreadable order list.');
  return data.map(readOrder);
}

/** GET /orders/:id/tracking — fetch order tracking history */
export async function getOrderTracking(orderId: string): Promise<{ events: TrackingEvent[] }> {
  return readTracking(await apiFetch<unknown>(
    `/orders/${encodeURIComponent(orderId)}/tracking`,
  ));
}

/** POST /orders/:id/cancel — customer cancellation; FastAPI enforces eligibility. */
export async function cancelOrder(orderId: string, reason: string): Promise<Order> {
  return readOrder(await apiFetch<unknown>(`/orders/${encodeURIComponent(orderId)}/cancel`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  }));
}
