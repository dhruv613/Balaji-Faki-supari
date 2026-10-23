/**
 * Payments API — typed functions for FastAPI integration.
 *
 * Payment verification is ALWAYS server-side. The frontend only
 * uploads the payment screenshot and polls for status. It never marks a
 * payment as verified.
 */

import { readPaymentStatus } from '../../../lib/contracts';
import { apiFetch, resolveApiUrl } from '../../../lib/api';
import { getAccessToken } from '../../../lib/auth';
import type { PaymentStatusResponse, PaymentSubmissionResult, OrderStatus, PaymentStatus } from '../../../types/orders';

/** Allowed screenshot formats and size (must match FastAPI validation). */
export const SCREENSHOT_ACCEPT = ['image/jpeg', 'image/png', 'image/webp'];
export const SCREENSHOT_MAX_BYTES = 4 * 1024 * 1024; // the host rejects request bodies above 4.5 MB

const VALID_SUBMISSION_STATUSES: ReadonlyArray<string> = [
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

type KeyStorage = Pick<Storage, 'getItem' | 'setItem'>;

function defaultKeyStorage(): KeyStorage | null {
  try { return typeof sessionStorage === 'undefined' ? null : sessionStorage; } catch { return null; }
}

/**
 * One Idempotency-Key per payment ATTEMPT. Retrying the same submission (network drop, double click, reload) reuses
 * the key, so the server returns the same attempt instead of creating a second one. A genuinely new attempt (different
 * screenshot, or a new attempt number after a rejection) gets a new key.
 */
export function paymentAttemptKey(
  orderId: string,
  screenshot: Pick<File, 'name' | 'size' | 'type' | 'lastModified'>,
  attemptNumber = 0,
  storage: KeyStorage | null = defaultKeyStorage(),
): string {
  const fingerprint = [orderId, screenshot.name, screenshot.size, screenshot.type, screenshot.lastModified, attemptNumber].join('|');
  const storageKey = `bfp-payment-attempt:${fingerprint}`;
  try {
    const existing = storage?.getItem(storageKey);
    if (existing) return existing;
  } catch { /* storage unavailable: fall through to a fresh key */ }
  const key = `payment-${orderId}-${crypto.randomUUID()}`;
  try { storage?.setItem(storageKey, key); } catch { /* retries within this page still reuse the key below */ }
  return key;
}

/**
 * POST /payments/:orderId/submit — multipart upload of the payment screenshot (the only evidence the shop asks for).
 *
 * FastAPI stores the screenshot in the PRIVATE `payment-proofs` bucket and
 * records the submission with Payment = SUBMITTED and Order = PAYMENT_REVIEW.
 * A successful response means "proof received", NOT "payment verified".
 */
export async function submitPayment(
  orderId: string,
  payload: { screenshot: File; attemptNumber?: number },
): Promise<PaymentSubmissionResult> {
  const invalid = validateScreenshot(payload.screenshot);
  if (invalid) throw new Error(invalid);
  const form = new FormData();
  form.append('screenshot', payload.screenshot);

  const result = await apiFetch<PaymentSubmissionResult>(
    `/payments/${encodeURIComponent(orderId)}/submit`,
    {
      method: 'POST',
      body: form,
      headers: { 'Idempotency-Key': paymentAttemptKey(orderId, payload.screenshot, payload.attemptNumber ?? 0) },
    },
  );
  if (!VALID_SUBMISSION_STATUSES.includes(String(result?.paymentStatus))) {
    throw new Error('The server did not confirm receipt. Please check the order status before retrying.');
  }
  return result;
}

/** GET /payments/:orderId/status — server-reported verification status */
export async function getPaymentStatus(orderId: string): Promise<PaymentStatusResponse> {
  return readPaymentStatus(
    await apiFetch<unknown>(`/payments/${encodeURIComponent(orderId)}/status`),
    orderId,
  );
}

/** Download the server-generated proof receipt. Upload alone does not verify payment. */
export async function downloadPaymentReceipt(orderId: string, orderNumber: string): Promise<void> {
  const token = await getAccessToken();
  if (!token) throw new Error('Please sign in to download your payment proof receipt.');
  let response: Response;
  try {
    response = await fetch(resolveApiUrl(`/api/payments/${encodeURIComponent(orderId)}/receipt`), {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/pdf' },
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new Error('Could not reach the server. Please check your connection and try again.');
  }
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const detail = body && typeof body === 'object' && 'detail' in body && typeof body.detail === 'string'
      ? body.detail : 'Could not download the receipt. Please try again.';
    throw new Error(detail);
  }
  if (!response.headers.get('Content-Type')?.toLowerCase().startsWith('application/pdf')) {
    throw new Error('The server did not return a PDF receipt. Please try again.');
  }
  const blob = await response.blob();
  if (!blob.size) throw new Error('The server returned an empty receipt. Please try again.');
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `payment-proof-${(orderNumber || orderId).replace(/[^a-zA-Z0-9_-]/g, '') || 'order'}.pdf`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Returns an error message for an invalid screenshot, or null if valid. */
export function validateScreenshot(file: File | null): string | null {
  if (!file) return 'Please upload your payment screenshot.';
  if (!SCREENSHOT_ACCEPT.includes(file.type)) return 'Upload a JPG, PNG or WEBP image.';
  if (file.size === 0) return 'The screenshot file is empty.';
  if (file.size > SCREENSHOT_MAX_BYTES) return 'Screenshot must be smaller than 4 MB.';
  return null;
}

export function isPaymentSubmittedOrVerified(status: PaymentStatus | null | undefined): boolean {
  if (!status) return false;
  return ['SUBMITTED', 'UNDER_REVIEW', 'VERIFIED', 'verifying', 'verified'].includes(status);
}

export function isConfirmedOrder(status: OrderStatus): boolean {
  return [
    'CONFIRMED',
    'PACKING',
    'PACKED',
    'PICKED_UP',
    'SHIPPED',
    'OUT_FOR_DELIVERY',
    'DELIVERED',
    'active',
    'packing',
    'dispatched',
    'out_for_delivery',
    'delivered',
  ].includes(status);
}

export function isPaymentConfirmed(result: PaymentStatusResponse): boolean {
  return (result.status === 'VERIFIED' || result.status === 'verified') && isConfirmedOrder(result.orderStatus);
}
