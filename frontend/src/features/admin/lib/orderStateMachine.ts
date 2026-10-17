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
  ApprovePaymentRequest,
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
/*  3. MANUAL PAYMENT VERIFICATION RULES (MODULE 03)                  */
/* ================================================================== */

export interface PaymentApprovalValidationInput {
  currentPaymentStatus: AdminPaymentStatus;
  expectedAmount: number | null;
  submittedUtr: string;
  approvalInput: ApprovePaymentRequest;
  existingVerifiedUtrs?: string[];
  existingBankCreditRefs?: string[];
}

/**
 * Enforces strict manual payment approval rules:
 * - Cannot approve an already VERIFIED payment (prevents duplicate updates).
 * - Expected amount must be known and match verifiedAmount exactly.
 * - UTR must be 12 digits and match the submitted UTR.
 * - No duplicate verified UTR or duplicate bank-credit reference.
 * - Receiving bank account and bank credit reference are mandatory.
 * - Transaction status must be 'CREDITED'.
 */
export function validatePaymentApproval(
  params: PaymentApprovalValidationInput,
): StateTransitionCheck {
  const {
    currentPaymentStatus,
    expectedAmount,
    submittedUtr,
    approvalInput,
    existingVerifiedUtrs = [],
    existingBankCreditRefs = [],
  } = params;

  if (currentPaymentStatus === 'VERIFIED') {
    return {
      allowed: false,
      reason: 'Payment is already VERIFIED. Duplicate payment approval is blocked.',
    };
  }

  if (!['SUBMITTED', 'UNDER_REVIEW'].includes(currentPaymentStatus)) {
    return {
      allowed: false,
      reason: `Payment in ${currentPaymentStatus} state cannot be approved before proof submission.`,
    };
  }

  if (expectedAmount === null || !Number.isFinite(expectedAmount) || expectedAmount <= 0) {
    return {
      allowed: false,
      reason: 'Expected order amount is unavailable. Cannot verify payment.',
    };
  }

  if (!approvalInput.receivingBankAccount || approvalInput.receivingBankAccount.trim().length < 4) {
    return {
      allowed: false,
      reason: 'Receiving bank account must be confirmed before approval.',
    };
  }

  if (!approvalInput.bankCreditReference || approvalInput.bankCreditReference.trim().length < 4) {
    return {
      allowed: false,
      reason: 'Bank credit reference is required to prove actual bank settlement.',
    };
  }

  const cleanUtr = approvalInput.verifiedUtr.trim();
  if (!/^\d{12}$/.test(cleanUtr)) {
    return {
      allowed: false,
      reason: 'Verified UTR must be an exact 12-digit UPI transaction reference.',
    };
  }

  if (submittedUtr.trim() && cleanUtr !== submittedUtr.trim()) {
    return {
      allowed: false,
      reason: 'Verified bank UTR does not match the customer-submitted UTR.',
    };
  }

  if (existingVerifiedUtrs.includes(cleanUtr)) {
    return {
      allowed: false,
      reason: `Duplicate UTR detected (${cleanUtr}). This UTR is already assigned to another verified payment.`,
    };
  }

  const cleanBankRef = approvalInput.bankCreditReference.trim();
  if (existingBankCreditRefs.includes(cleanBankRef)) {
    return {
      allowed: false,
      reason: `Duplicate bank credit reference (${cleanBankRef}). This bank credit is already linked to another order.`,
    };
  }

  if (Math.abs(approvalInput.verifiedAmount - expectedAmount) >= 0.01) {
    return {
      allowed: false,
      reason: `Verified bank credit amount (₹${approvalInput.verifiedAmount}) does not match expected order amount (₹${expectedAmount}).`,
    };
  }

  if (approvalInput.transactionStatus !== 'CREDITED') {
    return {
      allowed: false,
      reason: 'Bank transaction status must be CREDITED before approving payment.',
    };
  }

  return { allowed: true };
}

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

export function isAuthorizedOwnerAdmin(user: {
  role?: UserRole | string | null;
  appMetadataRole?: string | null;
} | null): boolean {
  if (!user) return false;
  if (user.role === 'CUSTOMER' || user.appMetadataRole === 'CUSTOMER') return false;
  return user.role === 'OWNER_ADMIN' || user.appMetadataRole === 'OWNER_ADMIN';
}
