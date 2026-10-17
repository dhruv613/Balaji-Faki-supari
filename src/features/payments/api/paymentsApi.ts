/**
 * Payments API — typed functions for FastAPI integration.
 *
 * Payment verification is ALWAYS server-side. The frontend only
 * submits UTR / screenshot and polls for status. It never marks a
 * payment as verified.
 */

import { readPaymentStatus } from '../../../lib/contracts';
import { apiFetch } from '../../../lib/api';
import type { PaymentStatusResponse, PaymentSubmissionResult, OrderStatus } from '../../../types/orders';

/** Allowed screenshot formats and size (must match FastAPI validation). */
export const SCREENSHOT_ACCEPT = ['image/jpeg', 'image/png', 'image/webp'];
export const SCREENSHOT_MAX_BYTES = 5 * 1024 * 1024;

/**
 * POST /payments/:orderId/submit — multipart upload of UTR + screenshot.
 *
 * FastAPI stores the screenshot in a PRIVATE Supabase Storage bucket using
 * its server-side credentials and records the submission as `verifying`.
 * A successful response means "received", NOT "paid".
 */
export async function submitPayment(
  orderId: string,
  payload: { utrNumber: string; screenshot: File },
): Promise<PaymentSubmissionResult> {
  const invalid = validateUtr(payload.utrNumber) ?? validateScreenshot(payload.screenshot);
  if (invalid) throw new Error(invalid);
  const form = new FormData();
  form.append('utr', payload.utrNumber);
  form.append('screenshot', payload.screenshot);

  const result = await apiFetch<PaymentSubmissionResult>(
    `/payments/${encodeURIComponent(orderId)}/submit`,
    { method: 'POST', body: form, headers: { 'Idempotency-Key': `payment-${orderId}-${payload.utrNumber.trim()}` } },
  );
  if (!['pending', 'verifying', 'verified', 'failed'].includes(result?.paymentStatus)) throw new Error('The server did not confirm receipt. Please check the order status before retrying.');
  return result;
}

/** GET /payments/:orderId/status — server-reported verification status */
export async function getPaymentStatus(orderId: string): Promise<PaymentStatusResponse> {
  return readPaymentStatus(await apiFetch<unknown>(
    `/payments/${encodeURIComponent(orderId)}/status`,
  ), orderId);
}

/** Returns an error message for an invalid screenshot, or null if valid. */
export function validateScreenshot(file: File | null): string | null {
  if (!file) return 'Please upload your payment screenshot.';
  if (!SCREENSHOT_ACCEPT.includes(file.type)) return 'Upload a JPG, PNG or WEBP image.';
  if (file.size === 0) return 'The screenshot file is empty.';
  if (file.size > SCREENSHOT_MAX_BYTES) return 'Screenshot must be smaller than 5 MB.';
  return null;
}

/** UPI UTR / RRN is a 12-digit number. */
export function validateUtr(utr: string): string | null {
  if (!utr.trim()) return 'Enter your UPI transaction ID (UTR).';
  if (!/^\d{12}$/.test(utr.trim())) return 'UTR must be exactly 12 digits.';
  return null;
}

/** Mask a UTR for display: 412345678912 → 4XXXXXXXX912 */
export function maskUtr(utr: string): string {
  if (utr.length < 5) return utr;
  return `${utr[0]}${'X'.repeat(utr.length - 4)}${utr.slice(-3)}`;
}

export function isConfirmedOrder(status: OrderStatus): boolean {
  return ['active', 'packing', 'dispatched', 'out_for_delivery', 'delivered'].includes(status);
}

export function isPaymentConfirmed(result: PaymentStatusResponse): boolean {
  return result.status === 'verified' && isConfirmedOrder(result.orderStatus);
}
