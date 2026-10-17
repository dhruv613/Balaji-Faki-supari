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
  AdminPaymentsQueryParams,
  ApprovePaymentRequest,
  RejectPaymentRequest,
  AdminProduct,
  CreateAdminProductRequest,
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
): Promise<PaginatedResponse<AdminOrderSummary>> {
  return apiFetch<PaginatedResponse<AdminOrderSummary>>(
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
        'Idempotency-Key': `admin-approve-payment-${paymentId}-${payload.verifiedUtr.trim()}`,
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
  return apiFetch<AdminProduct[]>(resolveApiPath('/api/admin/products'));
}

/** POST /api/admin/products */
export async function createAdminProduct(
  payload: CreateAdminProductRequest,
): Promise<AdminProduct> {
  return apiFetch<AdminProduct>(resolveApiPath('/api/admin/products'), {
    method: 'POST',
    body: JSON.stringify(payload),
  });
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
  return apiFetch<AdminInventoryResponse>(resolveApiPath('/api/admin/inventory'));
}

/** POST /api/admin/inventory/adjustments */
export async function createStockAdjustment(
  payload: StockAdjustmentRequest,
): Promise<StockMovementRecord> {
  return apiFetch<StockMovementRecord>(resolveApiPath('/api/admin/inventory/adjustments'), {
    method: 'POST',
    body: JSON.stringify(payload),
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

/** PATCH /api/admin/settings */
export async function updateAdminSettings(
  payload: UpdateAdminSettingsRequest,
): Promise<AdminStoreSettings> {
  return apiFetch<AdminStoreSettings>(resolveApiPath('/api/admin/settings'), {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}
