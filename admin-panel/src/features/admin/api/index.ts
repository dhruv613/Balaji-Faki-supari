/**
 * Balaji Faki Point — Typed Admin API Client
 *
 * Implements all Section 8 backend API contracts through `apiFetch`.
 * Never fabricates or simulates successful financial, order, or database
 * mutations when FastAPI is unavailable.
 */

import { apiFetch } from '../../../lib/api';
import { env } from '../../../lib/env';
import type {
  AuthenticatedUserProfile,
  PaginatedResponse,
  AdminDashboardResponse,
  AdminOrderSummary,
  AdminOrderDetail,
  AdminOrdersQueryParams,
  ConfirmOrderRequest,
  UpdateOrderStatusRequest,
  AdminPaymentSubmission,
  AdminPaymentProofResponse,
  AdminPaymentsQueryParams,
  ApprovePaymentRequest,
  ReviewPaymentRequest,
  RejectPaymentRequest,
  AdminProduct,
  UpdateAdminProductRequest,
  AdminInventoryResponse,
  StockAdjustmentRequest,
  StockMovementRecord,
  AdminDeliveryRecord,
  AdminDeliveriesQueryParams,
  UpdateDeliveryRequest,
  AdminCustomer,
  AdminCustomerDetailRecord,
  AdminCustomersQueryParams,
  AdminReviewRecord,
  AdminReviewsQueryParams,
  UpdateAdminReviewRequest,
  AdminRefundRecord,
  AdminRefundsQueryParams,
  ApproveRefundRequest,
  RecordRefundTransferRequest,
  AdminReportsQueryParams,
  AdminReportResponse,
  AdminNotificationsQueryParams,
  AdminNotificationsResponse,
  AdminNotificationLog,
  AdminStoreSettings,
  UpdateAdminSettingsRequest,
} from '../types';

/**
 * Normalizes `/api/...` paths whether `VITE_API_BASE_URL` ends with `/api` or not.
 */
export function resolveApiPath(apiPath: string): string {
  const normalized = apiPath.startsWith('/') ? apiPath : `/${apiPath}`;
  if (env.apiBaseUrl.endsWith('/api') && normalized.startsWith('/api/')) {
    return normalized.slice(4);
  }
  return normalized;
}

/**
 * Builds a URL query string from a parameter object, omitting undefined/empty/ALL values.
 */
export function buildQueryString(params?: object): string {
  if (!params) return '';
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params as Record<string, unknown>)) {
    if (value === undefined || value === null || value === '' || value === 'ALL') continue;
    searchParams.set(key, String(value));
  }
  const qs = searchParams.toString();
  return qs ? `?${qs}` : '';
}

/* ================================================================== */
/*  AUTHENTICATION                                                    */
/* ================================================================== */

/** GET /api/me — Verify authenticated identity and server-enforced role */
export async function getAdminMe(): Promise<AuthenticatedUserProfile> {
  return apiFetch<AuthenticatedUserProfile>(resolveApiPath('/api/me'));
}

/* ================================================================== */
/*  MODULE 01 — DASHBOARD                                             */
/* ================================================================== */

/** GET /api/admin/dashboard */
export async function getAdminDashboard(): Promise<AdminDashboardResponse> {
  return apiFetch<AdminDashboardResponse>(resolveApiPath('/api/admin/dashboard'));
}

/* ================================================================== */
/*  MODULE 02 — ORDERS                                                */
/* ================================================================== */

/** GET /api/admin/orders */
export async function getAdminOrders(
  params?: AdminOrdersQueryParams,
): Promise<PaginatedResponse<AdminOrderDetail>> {
  return apiFetch<PaginatedResponse<AdminOrderDetail>>(
    `${resolveApiPath('/api/admin/orders')}${buildQueryString(params)}`,
  );
}

/** GET /api/admin/orders/{id} */
export async function getAdminOrderById(orderId: string): Promise<AdminOrderDetail> {
  return apiFetch<AdminOrderDetail>(
    resolveApiPath(`/api/admin/orders/${encodeURIComponent(orderId)}`),
  );
}

/**
 * POST /api/admin/orders/{id}/confirm
 * Requires paymentStatus === 'VERIFIED'. Transitions order to CONFIRMED.
 */
export async function confirmAdminOrder(
  orderId: string,
  payload: ConfirmOrderRequest = {},
): Promise<AdminOrderDetail> {
  return apiFetch<AdminOrderDetail>(
    resolveApiPath(`/api/admin/orders/${encodeURIComponent(orderId)}/confirm`),
    {
      method: 'POST',
      headers: { 'Idempotency-Key': `admin-confirm-order-${orderId}` },
      body: JSON.stringify(payload),
    },
  );
}

/**
 * PATCH /api/admin/orders/{id}/status
 * Validates allowed previous state on the server and records audit history.
 */
export async function updateAdminOrderStatus(
  orderId: string,
  payload: UpdateOrderStatusRequest,
): Promise<AdminOrderDetail> {
  return apiFetch<AdminOrderDetail>(
    resolveApiPath(`/api/admin/orders/${encodeURIComponent(orderId)}/status`),
    {
      method: 'PATCH',
      body: JSON.stringify(payload),
    },
  );
}

/* ================================================================== */
/*  MODULE 03 — MANUAL PAYMENT VERIFICATION                           */
/* ================================================================== */

/** GET /api/admin/payments */
export async function getAdminPayments(
  params?: AdminPaymentsQueryParams,
): Promise<PaginatedResponse<AdminPaymentSubmission>> {
  return apiFetch<PaginatedResponse<AdminPaymentSubmission>>(
    `${resolveApiPath('/api/admin/payments')}${buildQueryString(params)}`,
  );
}

/** GET /api/admin/payments/{id} */
export async function getAdminPaymentById(paymentId: string): Promise<AdminPaymentSubmission> {
  return apiFetch<AdminPaymentSubmission>(
    resolveApiPath(`/api/admin/payments/${encodeURIComponent(paymentId)}`),
  );
}

/** GET /api/admin/payments/{id}/proof — Issue short-lived signed URL for private screenshot */
export async function getAdminPaymentProof(paymentId: string): Promise<AdminPaymentProofResponse> {
  return apiFetch<AdminPaymentProofResponse>(
    resolveApiPath(`/api/admin/payments/${encodeURIComponent(paymentId)}/proof`),
  );
}

/**
 * POST /api/admin/payments/{id}/review
 * Explicitly moves a persisted proof from SUBMITTED to UNDER_REVIEW.
 */
export async function startAdminPaymentReview(
  paymentId: string,
  payload: ReviewPaymentRequest = {},
): Promise<AdminPaymentSubmission> {
  return apiFetch<AdminPaymentSubmission>(
    resolveApiPath(`/api/admin/payments/${encodeURIComponent(paymentId)}/review`),
    {
      method: 'POST',
      headers: { 'Idempotency-Key': `admin-review-payment-${paymentId}` },
      body: JSON.stringify(payload),
    },
  );
}

/**
 * POST /api/admin/payments/{id}/approve
 * Sets PaymentStatus = VERIFIED and OrderStatus = AWAITING_CONFIRMATION atomically.
 */
export async function approveAdminPayment(
  paymentId: string,
  payload: ApprovePaymentRequest,
): Promise<AdminPaymentSubmission> {
  return apiFetch<AdminPaymentSubmission>(
    resolveApiPath(`/api/admin/payments/${encodeURIComponent(paymentId)}/approve`),
    {
      method: 'POST',
      headers: {
        'Idempotency-Key': `admin-approve-payment-${paymentId}`,
      },
      body: JSON.stringify(payload),
    },
  );
}

/**
 * POST /api/admin/payments/{id}/reject
 * Rejects unverified/mismatched payment proof or requests corrected proof.
 */
export async function rejectAdminPayment(
  paymentId: string,
  payload: RejectPaymentRequest,
): Promise<AdminPaymentSubmission> {
  return apiFetch<AdminPaymentSubmission>(
    resolveApiPath(`/api/admin/payments/${encodeURIComponent(paymentId)}/reject`),
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
  );
}

/* ================================================================== */
/*  MODULE 04 — PRODUCTS                                              */
/* ================================================================== */

/** GET /api/admin/products */
export async function getAdminProducts(): Promise<AdminProduct[]> {
  return apiFetch<AdminProduct[]>(resolveApiPath('/api/admin/products'), { cache: 'no-store' });
}

/** POST /api/admin/products/{id}/images - upload one product photo (public catalogue bucket) */
export async function addAdminProductImage(productId: string, file: File, altText: string): Promise<AdminProduct> {
  const form = new FormData();
  form.append('image', file);
  form.append('altText', altText);
  return apiFetch<AdminProduct>(resolveApiPath(`/api/admin/products/${encodeURIComponent(productId)}/images`), {
    method: 'POST',
    body: form,
  });
}

/** DELETE /api/admin/products/{id}/images/{imageId} */
export async function deleteAdminProductImage(productId: string, imageId: string): Promise<AdminProduct> {
  return apiFetch<AdminProduct>(
    resolveApiPath(`/api/admin/products/${encodeURIComponent(productId)}/images/${encodeURIComponent(imageId)}`),
    { method: 'DELETE' },
  );
}

/** PATCH /api/admin/products/{id} */
export async function updateAdminProduct(
  productId: string,
  payload: UpdateAdminProductRequest,
): Promise<AdminProduct> {
  return apiFetch<AdminProduct>(
    resolveApiPath(`/api/admin/products/${encodeURIComponent(productId)}`),
    {
      method: 'PATCH',
      body: JSON.stringify(payload),
    },
  );
}

/* ================================================================== */
/*  MODULE 05 — INVENTORY & STOCK                                     */
/* ================================================================== */

/** GET /api/admin/inventory */
export async function getAdminInventory(): Promise<AdminInventoryResponse> {
  return apiFetch<AdminInventoryResponse>(resolveApiPath('/api/admin/inventory'), { cache: 'no-store' });
}

/** POST /api/admin/inventory/adjustments */
export async function createStockAdjustment(
  payload: StockAdjustmentRequest,
): Promise<StockMovementRecord> {
  // The server validates strictly (extra fields are refused), so only the fields it defines are sent.
  const { inventoryItemId, adjustmentType, quantity, reason } = payload;
  return apiFetch<StockMovementRecord>(resolveApiPath('/api/admin/inventory/adjustments'), {
    method: 'POST',
    body: JSON.stringify({ inventoryItemId, adjustmentType, quantity, reason }),
  });
}

/* ================================================================== */
/*  MODULE 06 — DELIVERY MANAGEMENT                                   */
/* ================================================================== */

/** GET /api/admin/deliveries */
export async function getAdminDeliveries(
  params?: AdminDeliveriesQueryParams,
): Promise<PaginatedResponse<AdminDeliveryRecord>> {
  return apiFetch<PaginatedResponse<AdminDeliveryRecord>>(
    `${resolveApiPath('/api/admin/deliveries')}${buildQueryString(params)}`,
  );
}

/** PATCH /api/admin/deliveries/{id} */
export async function updateAdminDelivery(
  deliveryId: string,
  payload: UpdateDeliveryRequest,
): Promise<AdminDeliveryRecord> {
  return apiFetch<AdminDeliveryRecord>(
    resolveApiPath(`/api/admin/deliveries/${encodeURIComponent(deliveryId)}`),
    {
      method: 'PATCH',
      body: JSON.stringify(payload),
    },
  );
}

/* ================================================================== */
/*  MODULE 07 — CUSTOMERS                                             */
/* ================================================================== */

/** GET /api/admin/customers */
export async function getAdminCustomers(
  params?: AdminCustomersQueryParams,
): Promise<PaginatedResponse<AdminCustomer>> {
  return apiFetch<PaginatedResponse<AdminCustomer>>(
    `${resolveApiPath('/api/admin/customers')}${buildQueryString(params)}`,
  );
}

/** GET /api/admin/customers/{id} */
export async function getAdminCustomerById(
  customerId: string,
): Promise<AdminCustomerDetailRecord> {
  return apiFetch<AdminCustomerDetailRecord>(
    resolveApiPath(`/api/admin/customers/${encodeURIComponent(customerId)}`),
  );
}

/* ================================================================== */
/*  MODULE 08 — REVIEWS & FEEDBACK                                    */
/* ================================================================== */

/** GET /api/admin/reviews */
export async function getAdminReviews(
  params?: AdminReviewsQueryParams,
): Promise<PaginatedResponse<AdminReviewRecord>> {
  return apiFetch<PaginatedResponse<AdminReviewRecord>>(
    `${resolveApiPath('/api/admin/reviews')}${buildQueryString(params)}`,
  );
}

/** PATCH /api/admin/reviews/{id} */
export async function updateAdminReview(
  reviewId: string,
  payload: UpdateAdminReviewRequest,
): Promise<AdminReviewRecord> {
  return apiFetch<AdminReviewRecord>(
    resolveApiPath(`/api/admin/reviews/${encodeURIComponent(reviewId)}`),
    {
      method: 'PATCH',
      body: JSON.stringify(payload),
    },
  );
}

/* ================================================================== */
/*  MODULE 09 — CANCELLATIONS & REFUNDS                               */
/* ================================================================== */

/** GET /api/admin/refunds */
export async function getAdminRefunds(
  params?: AdminRefundsQueryParams,
): Promise<PaginatedResponse<AdminRefundRecord>> {
  return apiFetch<PaginatedResponse<AdminRefundRecord>>(
    `${resolveApiPath('/api/admin/refunds')}${buildQueryString(params)}`,
  );
}

/** POST /api/admin/refunds/{id}/approve */
export async function approveAdminRefund(
  refundId: string,
  payload: ApproveRefundRequest = {},
): Promise<AdminRefundRecord> {
  return apiFetch<AdminRefundRecord>(
    resolveApiPath(`/api/admin/refunds/${encodeURIComponent(refundId)}/approve`),
    {
      method: 'POST',
      headers: { 'Idempotency-Key': `admin-approve-refund-${refundId}` },
      body: JSON.stringify(payload),
    },
  );
}

/** POST /api/admin/refunds/{id}/record-transfer */
export async function recordAdminRefundTransfer(
  refundId: string,
  payload: RecordRefundTransferRequest,
): Promise<AdminRefundRecord> {
  return apiFetch<AdminRefundRecord>(
    resolveApiPath(`/api/admin/refunds/${encodeURIComponent(refundId)}/record-transfer`),
    {
      method: 'POST',
      headers: {
        'Idempotency-Key': `admin-refund-transfer-${refundId}-${payload.refundTransactionReference.trim()}`,
      },
      body: JSON.stringify(payload),
    },
  );
}

/* ================================================================== */
/*  MODULE 10 — REPORTS & EXPORTS                                     */
/* ================================================================== */

/** GET /api/admin/reports */
export async function getAdminReports(
  params: AdminReportsQueryParams,
): Promise<AdminReportResponse> {
  return apiFetch<AdminReportResponse>(
    `${resolveApiPath('/api/admin/reports')}${buildQueryString(params)}`,
  );
}

/* ================================================================== */
/*  MODULE 11 — CUSTOMER NOTIFICATIONS                                */
/* ================================================================== */

/** GET /api/admin/notifications */
export async function getAdminNotifications(
  params?: AdminNotificationsQueryParams,
): Promise<AdminNotificationsResponse> {
  return apiFetch<AdminNotificationsResponse>(
    `${resolveApiPath('/api/admin/notifications')}${buildQueryString(params)}`,
  );
}

/** POST /api/admin/notifications/{id}/retry */
export async function retryFailedNotification(
  notificationId: string,
): Promise<AdminNotificationLog> {
  return apiFetch<AdminNotificationLog>(
    resolveApiPath(`/api/admin/notifications/${encodeURIComponent(notificationId)}/retry`),
    { method: 'POST' },
  );
}

/* ================================================================== */
/*  MODULE 12 — STORE SETTINGS                                        */
/* ================================================================== */

/** GET /api/admin/settings */
export async function getAdminSettings(): Promise<AdminStoreSettings> {
  return apiFetch<AdminStoreSettings>(resolveApiPath('/api/admin/settings'));
}

/** PATCH /api/admin/settings - only the fields sent are changed */
export async function updateAdminSettings(
  payload: UpdateAdminSettingsRequest,
): Promise<AdminStoreSettings> {
  return apiFetch<AdminStoreSettings>(resolveApiPath('/api/admin/settings'), {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

/** POST /api/admin/settings/confirm - the owner attests that payment, delivery and PIN settings are real */
export async function confirmBusinessSettings(note?: string): Promise<AdminStoreSettings> {
  return apiFetch<AdminStoreSettings>(resolveApiPath('/api/admin/settings/confirm'), {
    method: 'POST',
    body: JSON.stringify({ confirm: true, note: note?.trim() || undefined }),
  });
}

/** POST /api/admin/settings/qr - replaces the private payment QR (withdraws confirmation) */
export async function uploadPaymentQr(file: File): Promise<AdminStoreSettings> {
  const form = new FormData();
  form.append('qr', file);
  return apiFetch<AdminStoreSettings>(resolveApiPath('/api/admin/settings/qr'), { method: 'POST', body: form });
}

/** POST /api/admin/settings/photos */
export async function addStorePhoto(file: File, caption: string): Promise<AdminStoreSettings> {
  const form = new FormData();
  form.append('photo', file);
  form.append('caption', caption);
  return apiFetch<AdminStoreSettings>(resolveApiPath('/api/admin/settings/photos'), { method: 'POST', body: form });
}

/** DELETE /api/admin/settings/photos/{id} */
export async function deleteStorePhoto(photoId: string): Promise<AdminStoreSettings> {
  return apiFetch<AdminStoreSettings>(resolveApiPath(`/api/admin/settings/photos/${encodeURIComponent(photoId)}`), {
    method: 'DELETE',
  });
}
