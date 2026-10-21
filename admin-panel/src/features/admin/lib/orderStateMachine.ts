/**
 * Balaji Faki Point — Structured Order, Payment, Delivery, Refund & Inventory
 * State Machine & Security Validation Rules.
 *
 * Enforces Section 3, 5, 6, and 12 requirements:
 * - Payment approval and Order confirmation are strictly separate actions.
 * - A payment approval sets PaymentStatus = VERIFIED and OrderStatus = AWAITING_CONFIRMATION.
 *   It NEVER moves an order directly to PACKING or SHIPPED.
 * - An order cannot be confirmed until paymentStatus === 'VERIFIED'.
 * - Packing cannot begin until orderStatus === 'CONFIRMED'.
 * - Cancelled orders cannot be shipped or packed.
 * - Refunds cannot be marked COMPLETED without a verified bank transaction reference.
 * - Stock adjustments cannot result in negative available stock.
 */

import type {
  AdminOrderStatus,
  AdminPaymentStatus,
  AdminDeliveryStatus,
  AdminRefundStatus,
  AdminOrderDetail,
  AdminProduct,
  AdminRefundRecord,
  RecordRefundTransferRequest,
  StockAdjustmentRequest,
  UserRole,
} from '../types';

/* ================================================================== */
/*  1. ORDER STATE MACHINE                                            */
/* ================================================================== */

export const ALLOWED_ORDER_TRANSITIONS: Record<AdminOrderStatus, readonly AdminOrderStatus[]> = {
  PENDING_PAYMENT: ['PAYMENT_REVIEW', 'CANCELLED'],
  PAYMENT_REVIEW: ['AWAITING_CONFIRMATION', 'PENDING_PAYMENT', 'CANCELLED'],
  AWAITING_CONFIRMATION: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['PACKING', 'CANCELLED'],
  PACKING: ['PACKED', 'CANCELLED'],
  PACKED: ['PICKED_UP', 'CANCELLED'],
  PICKED_UP: ['SHIPPED', 'DELIVERY_FAILED'],
  SHIPPED: ['OUT_FOR_DELIVERY', 'DELIVERY_FAILED'],
  OUT_FOR_DELIVERY: ['DELIVERED', 'DELIVERY_FAILED'],
  DELIVERY_FAILED: ['OUT_FOR_DELIVERY', 'CANCELLED'],
  DELIVERED: [],
  CANCELLED: [],
};

export const ORDER_STATUS_LABELS: Record<AdminOrderStatus, string> = {
  PENDING_PAYMENT: 'Pending payment',
  PAYMENT_REVIEW: 'Payment review',
  AWAITING_CONFIRMATION: 'Awaiting confirmation',
  CONFIRMED: 'Confirmed',
  PACKING: 'Packing',
  PACKED: 'Packed',
  PICKED_UP: 'Picked up',
  SHIPPED: 'Shipped',
  OUT_FOR_DELIVERY: 'Out for delivery',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
  DELIVERY_FAILED: 'Delivery failed',
};

export const ORDER_ACTION_LABELS: Partial<Record<AdminOrderStatus, string>> = {
  CONFIRMED: 'Confirm Order',
  PACKING: 'Start Packing',
  PACKED: 'Mark Packed',
  PICKED_UP: 'Mark Picked Up',
  SHIPPED: 'Mark Shipped',
  OUT_FOR_DELIVERY: 'Mark Out for Delivery',
  DELIVERED: 'Mark Delivered',
  DELIVERY_FAILED: 'Record Delivery Failure',
  CANCELLED: 'Cancel Order',
};

export interface AllowedOrderAction {
  nextStatus: AdminOrderStatus;
  label: string;
  tone: 'primary' | 'dark' | 'danger';
}

export const PAYMENT_STATUS_LABELS: Record<AdminPaymentStatus, string> = {
  PENDING: 'Pending',
  SUBMITTED: 'Submitted',
  UNDER_REVIEW: 'Under review',
  VERIFIED: 'Verified',
  REJECTED: 'Rejected',
};

export const REFUND_STATUS_LABELS: Record<AdminRefundStatus, string> = {
  NOT_REQUIRED: 'Not required',
  PENDING: 'Pending',
  APPROVED: 'Approved',
  PROCESSING: 'Processing',
  COMPLETED: 'Completed',
  FAILED: 'Failed',
};

export interface StateTransitionCheck {
  allowed: boolean;
  reason?: string;
}

/**
 * Validates whether an order can transition from `currentStatus` to `nextStatus`
 * given its current `paymentStatus` and available stock.
 */
export function validateOrderTransition(params: {
  currentStatus: AdminOrderStatus;
  nextStatus: AdminOrderStatus;
  paymentStatus: AdminPaymentStatus;
  availableStockSufficient?: boolean;
}): StateTransitionCheck {
  const { currentStatus, nextStatus, paymentStatus, availableStockSufficient = true } = params;

  if (currentStatus === nextStatus) {
    return { allowed: false, reason: `Order is already in ${ORDER_STATUS_LABELS[currentStatus]} state.` };
  }

  if (currentStatus === 'CANCELLED') {
    return { allowed: false, reason: 'Cancelled orders cannot be packed, shipped, or modified.' };
  }

  if (currentStatus === 'DELIVERED') {
    return { allowed: false, reason: 'Delivered orders are final and cannot change status.' };
  }

  // Critical Rule: Payment must be VERIFIED before order confirmation
  if (nextStatus === 'CONFIRMED' && paymentStatus !== 'VERIFIED') {
    return {
      allowed: false,
      reason: 'An order cannot be confirmed until payment is independently VERIFIED.',
    };
  }

  // Critical Rule: Confirming an order must validate stock
  if (nextStatus === 'CONFIRMED' && !availableStockSufficient) {
    return {
      allowed: false,
      reason: 'Insufficient available stock to confirm this order.',
    };
  }

  // Critical Rule: Packing cannot begin until the order is CONFIRMED
  if (nextStatus === 'PACKING') {
    if (paymentStatus !== 'VERIFIED') {
      return {
        allowed: false,
        reason: 'Unverified payment cannot move to packing.',
      };
    }
    if (currentStatus !== 'CONFIRMED') {
      return {
        allowed: false,
        reason: 'Packing cannot begin until the order is CONFIRMED.',
      };
    }
  }

  const allowedNext = ALLOWED_ORDER_TRANSITIONS[currentStatus] ?? [];
  if (!allowedNext.includes(nextStatus)) {
    return {
      allowed: false,
      reason: `Invalid transition from ${ORDER_STATUS_LABELS[currentStatus]} to ${ORDER_STATUS_LABELS[nextStatus]}. Cannot skip required fulfillment steps.`,
    };
  }

  return { allowed: true };
}

/**
 * Returns the list of valid next statuses for a given order.
 */
export function getAllowedNextOrderStatuses(
  currentStatus: AdminOrderStatus,
  paymentStatus: AdminPaymentStatus,
): AdminOrderStatus[] {
  const candidates = ALLOWED_ORDER_TRANSITIONS[currentStatus] ?? [];
  return candidates.filter((nextStatus) =>
    validateOrderTransition({ currentStatus, nextStatus, paymentStatus }).allowed,
  );
}

/**
 * Returns the explicit list of admin action buttons allowed for an order's current state.
 * Only actions valid in the order state machine are returned.
 */
export function getAllowedOrderActions(
  currentStatus: AdminOrderStatus,
  paymentStatus: AdminPaymentStatus,
): AllowedOrderAction[] {
  const allowedStatuses = getAllowedNextOrderStatuses(currentStatus, paymentStatus);
  const actions: AllowedOrderAction[] = [];

  for (const nextStatus of allowedStatuses) {
    const label = ORDER_ACTION_LABELS[nextStatus];
    if (!label) continue;
    actions.push({
      nextStatus,
      label,
      tone:
        nextStatus === 'CANCELLED' || nextStatus === 'DELIVERY_FAILED'
          ? 'danger'
          : nextStatus === 'CONFIRMED' || nextStatus === 'DELIVERED'
          ? 'primary'
          : 'dark',
    });
  }

  return actions;
}

/* ================================================================== */
/*  2. DELIVERY STATE MACHINE                                         */
/* ================================================================== */

export const ALLOWED_DELIVERY_TRANSITIONS: Record<AdminDeliveryStatus, readonly AdminDeliveryStatus[]> = {
  CONFIRMED: ['PACKING'],
  PACKING: ['PACKED'],
  PACKED: ['PICKED_UP'],
  PICKED_UP: ['SHIPPED', 'DELIVERY_FAILED'],
  SHIPPED: ['OUT_FOR_DELIVERY', 'DELIVERY_FAILED'],
  OUT_FOR_DELIVERY: ['DELIVERED', 'DELIVERY_FAILED'],
  DELIVERY_FAILED: ['OUT_FOR_DELIVERY'],
  DELIVERED: [],
};

export function validateDeliveryTransition(
  currentStatus: AdminDeliveryStatus,
  nextStatus: AdminDeliveryStatus,
): StateTransitionCheck {
  if (currentStatus === nextStatus) {
    return { allowed: false, reason: 'Delivery is already in this status.' };
  }
  const allowed = ALLOWED_DELIVERY_TRANSITIONS[currentStatus] ?? [];
  if (!allowed.includes(nextStatus)) {
    return {
      allowed: false,
      reason: `Cannot move delivery directly from ${ORDER_STATUS_LABELS[currentStatus]} to ${ORDER_STATUS_LABELS[nextStatus]}.`,
    };
  }
  return { allowed: true };
}

/* ================================================================== */
/*  3. PAYMENT APPROVAL RESULT (MODULE 03)                            */
/* ================================================================== */

/**
 * Computes the resulting state after a valid payment approval.
 * Payment approval changes:
 *   Payment Status = VERIFIED
 *   Order Status = AWAITING_CONFIRMATION
 * It NEVER automatically marks the order PACKING or SHIPPED.
 */
export function computePostPaymentApprovalState(): {
  paymentStatus: 'VERIFIED';
  orderStatus: 'AWAITING_CONFIRMATION';
} {
  return {
    paymentStatus: 'VERIFIED',
    orderStatus: 'AWAITING_CONFIRMATION',
  };
}

/* ================================================================== */
/*  4. REFUND VERIFICATION RULES (MODULE 09)                          */
/* ================================================================== */

export const ALLOWED_REFUND_TRANSITIONS: Record<AdminRefundStatus, readonly AdminRefundStatus[]> = {
  NOT_REQUIRED: [],
  PENDING: ['APPROVED', 'FAILED'],
  APPROVED: ['PROCESSING', 'COMPLETED', 'FAILED'],
  PROCESSING: ['COMPLETED', 'FAILED'],
  COMPLETED: [],
  FAILED: ['PROCESSING'],
};

/**
 * Validates recording a completed refund transfer.
 * A refund cannot be marked COMPLETED merely by clicking a button —
 * it requires a verified refund bank reference, bank account, date, and exact amount.
 */
export function validateRefundCompletion(params: {
  currentRefundStatus: AdminRefundStatus;
  expectedRefundAmount: number | null;
  transferInput: RecordRefundTransferRequest;
}): StateTransitionCheck {
  const { currentRefundStatus, expectedRefundAmount, transferInput } = params;

  if (currentRefundStatus === 'COMPLETED') {
    return { allowed: false, reason: 'Refund is already marked COMPLETED.' };
  }

  if (!['APPROVED', 'PROCESSING'].includes(currentRefundStatus)) {
    return {
      allowed: false,
      reason: 'Refund must be APPROVED before recording a completed bank transfer.',
    };
  }

  if (!transferInput.refundTransactionReference || transferInput.refundTransactionReference.trim().length < 6) {
    return {
      allowed: false,
      reason: 'A valid bank refund transaction reference / UTR (at least 6 characters) is required to complete a refund.',
    };
  }

  if (!transferInput.refundBankAccount || transferInput.refundBankAccount.trim().length < 4) {
    return {
      allowed: false,
      reason: 'Source bank account details are required to verify the refund transfer.',
    };
  }

  if (!transferInput.refundDate || !Number.isFinite(Date.parse(transferInput.refundDate))) {
    return {
      allowed: false,
      reason: 'A valid refund transaction date is required.',
    };
  }

  if (
    expectedRefundAmount === null ||
    !Number.isFinite(transferInput.verifiedAmount) ||
    Math.abs(transferInput.verifiedAmount - expectedRefundAmount) >= 0.01
  ) {
    return {
      allowed: false,
      reason: 'Verified refund transfer amount must match the approved refund amount.',
    };
  }

  return { allowed: true };
}

/* ================================================================== */
/*  5. INVENTORY & STOCK ADJUSTMENT RULES (MODULE 05)                 */
/* ================================================================== */

export function validateStockAdjustment(params: {
  currentAvailableStock: number;
  request: StockAdjustmentRequest;
}): StateTransitionCheck {
  const { currentAvailableStock, request } = params;

  if (!Number.isInteger(request.quantity) || request.quantity <= 0) {
    return {
      allowed: false,
      reason: 'Adjustment quantity must be a positive whole number.',
    };
  }

  if (!request.reason || request.reason.trim().length < 5) {
    return {
      allowed: false,
      reason: 'Please enter a clear reason (at least 5 characters) for the audit log.',
    };
  }

  if (request.adjustmentType === 'DEDUCT' && currentAvailableStock - request.quantity < 0) {
    return {
      allowed: false,
      reason: `Cannot deduct ${request.quantity} units when available stock is ${currentAvailableStock}. Negative available stock is never allowed.`,
    };
  }

  return { allowed: true };
}

/* ================================================================== */
/*  6. AUTHORIZATION & ROLE PERMISSION CHECKS (SECTION 5)             */
/* ================================================================== */

/* ================================================================== */
/*  7. DASHBOARD METRIC CALCULATIONS (PRODUCTS SOLD & NET PROFIT)     */
/* ================================================================== */

/**
 * Calculates total number of product units sold strictly from delivered/completed
 * orders whose payment is verified. Never hardcoded.
 */
export function calculateProductsSold(
  orders: ReadonlyArray<Pick<AdminOrderDetail, 'orderStatus' | 'paymentStatus' | 'items'>>,
  metricsOverride?: number | null,
): number {
  if (typeof metricsOverride === 'number' && Number.isFinite(metricsOverride) && metricsOverride >= 0) {
    return Math.trunc(metricsOverride);
  }
  return orders
    .filter((o) => o.orderStatus === 'DELIVERED' && o.paymentStatus === 'VERIFIED')
    .reduce((total, order) => {
      const units = order.items.reduce((sum, item) => sum + Math.max(0, Math.trunc(Number(item.quantity) || 0)), 0);
      return total + units;
    }, 0);
}

/**
 * Calculates actual Net Profit in INR from completed sales revenue minus
 * product purchase/cost prices, completed refunds, and delivery expenses.
 * If cost data or selling price data is unavailable, returns `null` so the UI
 * displays "Not configured" instead of fabricated profit.
 */
export function calculateNetProfit(params: {
  orders: ReadonlyArray<AdminOrderDetail>;
  products: ReadonlyArray<AdminProduct>;
  refunds?: ReadonlyArray<AdminRefundRecord>;
  metricsNetProfitOverride?: number | null;
}): number | null {
  const { orders, products, refunds = [], metricsNetProfitOverride } = params;

  if (typeof metricsNetProfitOverride === 'number' && Number.isFinite(metricsNetProfitOverride)) {
    return metricsNetProfitOverride;
  }

  const costMap = new Map<string, number | null>();
  for (const prod of products) {
    for (const variant of prod.variants) {
      costMap.set(`${prod.type}:${variant.packSize}`, variant.costPrice ?? null);
    }
  }

  const deliveredOrders = orders.filter(
    (o) => o.orderStatus === 'DELIVERED' && o.paymentStatus === 'VERIFIED',
  );

  if (deliveredOrders.length === 0) {
    const anyCostConfigured = products.some((p) =>
      p.variants.some((v) => v.costPrice !== null && v.costPrice !== undefined && Number.isFinite(v.costPrice)),
    );
    return anyCostConfigured ? 0 : null;
  }

  let totalRevenue = 0;
  let totalCost = 0;
  let totalDeliveryExpenses = 0;

  for (const order of deliveredOrders) {
    if (order.totalAmount === null || !Number.isFinite(order.totalAmount)) {
      return null;
    }
    totalRevenue += order.totalAmount;
    if (order.deliveryCharges !== null && Number.isFinite(order.deliveryCharges)) {
      totalDeliveryExpenses += order.deliveryCharges;
    }

    for (const item of order.items) {
      const unitCost =
        item.unitCostPrice !== undefined && item.unitCostPrice !== null
          ? item.unitCostPrice
          : costMap.get(`${item.productType}:${item.packSize}`) ?? null;
      if (unitCost === null || !Number.isFinite(unitCost)) {
        return null;
      }
      totalCost += unitCost * item.quantity;
    }
  }

  const completedRefundsTotal = refunds
    .filter((r) => r.refundStatus === 'COMPLETED')
    .reduce(
      (sum, r) => sum + (r.refundAmount !== null && Number.isFinite(r.refundAmount) ? r.refundAmount : 0),
      0,
    );

  return Math.round((totalRevenue - totalCost - totalDeliveryExpenses - completedRefundsTotal) * 100) / 100;
}

const ADMIN_DATA_CHANGED_EVENT = 'bfp:admin-data-changed';

export function notifyAdminDataChanged(): void {
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent(ADMIN_DATA_CHANGED_EVENT));
  }
}

export function subscribeAdminDataChanged(listener: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
    return () => {};
  }
  window.addEventListener(ADMIN_DATA_CHANGED_EVENT, listener);
  return () => window.removeEventListener(ADMIN_DATA_CHANGED_EVENT, listener);
}
