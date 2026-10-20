import type {
  AdminOrderStatus,
  AdminPaymentStatus,
  AdminRefundStatus,
  AdminDeliveryStatus,
  ReviewModerationStatus,
  EmailDeliveryStatus,
} from '../types';
import {
  ORDER_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  REFUND_STATUS_LABELS,
} from '../lib/orderStateMachine';

type AnyStatus =
  | AdminOrderStatus
  | AdminPaymentStatus
  | AdminRefundStatus
  | AdminDeliveryStatus
  | ReviewModerationStatus
  | EmailDeliveryStatus
  | string;

const STATUS_CLASS_MAP: Record<string, string> = {
  // Order & Delivery statuses
  DELIVERED: 'badge--green',
  CONFIRMED: 'badge--green',
  PACKED: 'badge--dark',
  PACKING: 'badge--info',
  PICKED_UP: 'badge--dark',
  SHIPPED: 'badge--dark',
  OUT_FOR_DELIVERY: 'badge--dark',
  AWAITING_CONFIRMATION: 'badge--warning',
  PAYMENT_REVIEW: 'badge--warning',
  PENDING_PAYMENT: 'badge--outline',
  CANCELLED: 'badge--danger',
  DELIVERY_FAILED: 'badge--danger',

  // Payment statuses
  VERIFIED: 'badge--green',
  SUBMITTED: 'badge--warning',
  UNDER_REVIEW: 'badge--warning',
  PENDING: 'badge--outline',
  REJECTED: 'badge--danger',

  // Refund statuses
  COMPLETED: 'badge--green',
  APPROVED: 'badge--info',
  PROCESSING: 'badge--warning',
  NOT_REQUIRED: 'badge--outline',
  FAILED: 'badge--danger',

  // Review moderation
  PUBLISHED: 'badge--green',
  HIDDEN: 'badge--outline',
  PENDING_MODERATION: 'badge--warning',

  // Email delivery
  SENT: 'badge--green',
  QUEUED_POST_COMMIT: 'badge--info',

  // Customer statuses
  Repeat: 'badge--dark',
  Active: 'badge--green',
  New: 'badge--outline',
  'Pending payment': 'badge--warning',
};

const EXTRA_LABELS: Record<string, string> = {
  PUBLISHED: 'Published',
  HIDDEN: 'Hidden',
  PENDING_MODERATION: 'Pending moderation',
  SENT: 'Sent',
  QUEUED_POST_COMMIT: 'Queued (post-commit)',
};

export interface StatusBadgeProps {
  status: AnyStatus;
  kind?: 'order' | 'payment' | 'refund' | 'general';
}

export default function StatusBadge({ status, kind = 'general' }: StatusBadgeProps) {
  const variant = STATUS_CLASS_MAP[status] ?? 'badge--outline';
  let label = status;

  if (kind === 'order' && status in ORDER_STATUS_LABELS) {
    label = ORDER_STATUS_LABELS[status as AdminOrderStatus];
  } else if (kind === 'payment' && status in PAYMENT_STATUS_LABELS) {
    label = PAYMENT_STATUS_LABELS[status as AdminPaymentStatus];
  } else if (kind === 'refund' && status in REFUND_STATUS_LABELS) {
    label = REFUND_STATUS_LABELS[status as AdminRefundStatus];
  } else if (status in ORDER_STATUS_LABELS) {
    label = ORDER_STATUS_LABELS[status as AdminOrderStatus];
  } else if (status in PAYMENT_STATUS_LABELS) {
    label = PAYMENT_STATUS_LABELS[status as AdminPaymentStatus];
  } else if (status in REFUND_STATUS_LABELS) {
    label = REFUND_STATUS_LABELS[status as AdminRefundStatus];
  } else if (status in EXTRA_LABELS) {
    label = EXTRA_LABELS[status];
  }

  return <span className={`badge ${variant}`}>{label}</span>;
}
