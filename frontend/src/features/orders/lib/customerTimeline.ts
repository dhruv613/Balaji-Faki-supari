import type { TrackingEvent } from '../../../types/orders';

/**
 * Customer-facing progress for My Orders → Order Details.
 *
 * The detailed backend state machine (PACKING, PICKED_UP, SHIPPED, …) and its tracking history are unchanged;
 * this only maps them to five simple stages:
 *   Order Confirmed → Packed → Shipped → Out for Delivery → Delivered
 * Before the shop confirms the order, a banner explains the payment-verification state instead.
 */
export type StepState = 'done' | 'current' | 'upcoming';

export interface TimelineStep {
  key: 'confirmed' | 'packed' | 'shipped' | 'out_for_delivery' | 'delivered';
  label: string;
  state: StepState;
  /** ISO timestamp of the first real history event for this stage; null until it has happened. */
  timestamp: string | null;
  detail: string | null;
}

export interface ProgressBanner {
  tone: 'info' | 'success' | 'warning' | 'error';
  title: string;
  text: string;
}

export interface CustomerProgress {
  steps: TimelineStep[];
  banner: ProgressBanner | null;
  /** The five stages are shown once the order is confirmed (or when it ended after confirmation). */
  showSteps: boolean;
}

/** Fulfilment states in the order they happen. */
const FULFILMENT = ['CONFIRMED', 'PACKING', 'PACKED', 'PICKED_UP', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED'] as const;

const STAGES: Array<{
  key: TimelineStep['key'];
  label: string;
  /** Reached once the order has progressed to this fulfilment state or beyond. */
  minState: (typeof FULFILMENT)[number];
  /** Timestamp comes from the first of these states in the history. */
  stampFrom: readonly string[];
  pendingDetail: string;
}> = [
  { key: 'confirmed', label: 'Order Confirmed', minState: 'CONFIRMED', stampFrom: ['CONFIRMED'], pendingDetail: 'The shop will confirm your order.' },
  { key: 'packed', label: 'Packed', minState: 'PACKED', stampFrom: ['PACKED'], pendingDetail: 'Waiting to be packed.' },
  { key: 'shipped', label: 'Shipped', minState: 'PICKED_UP', stampFrom: ['PICKED_UP', 'SHIPPED'], pendingDetail: 'Not shipped yet.' },
  { key: 'out_for_delivery', label: 'Out for Delivery', minState: 'OUT_FOR_DELIVERY', stampFrom: ['OUT_FOR_DELIVERY'], pendingDetail: 'Not out for delivery yet.' },
  { key: 'delivered', label: 'Delivered', minState: 'DELIVERED', stampFrom: ['DELIVERED'], pendingDetail: 'Not delivered yet.' },
];

function furthestFulfilment(status: string, events: readonly TrackingEvent[]): number {
  let furthest = FULFILMENT.indexOf(status.toUpperCase() as (typeof FULFILMENT)[number]);
  for (const event of events) {
    furthest = Math.max(furthest, FULFILMENT.indexOf(event.status.toUpperCase() as (typeof FULFILMENT)[number]));
  }
  return furthest;
}

function firstTimestamp(events: readonly TrackingEvent[], states: readonly string[]): string | null {
  const stamps = events
    .filter((event) => states.includes(event.status.toUpperCase()))
    .map((event) => event.timestamp)
    .sort((left, right) => Date.parse(left) - Date.parse(right));
  return stamps[0] ?? null;
}

export function buildCustomerProgress(
  order: { status: string; paymentStatus: string },
  events: readonly TrackingEvent[],
): CustomerProgress {
  const status = String(order.status).toUpperCase();
  const payment = String(order.paymentStatus).toUpperCase();
  const furthest = furthestFulfilment(status, events);

  const steps: TimelineStep[] = STAGES.map((stage) => {
    const reached = furthest >= FULFILMENT.indexOf(stage.minState);
    return {
      key: stage.key,
      label: stage.label,
      state: reached ? 'done' : 'upcoming',
      timestamp: reached ? firstTimestamp(events, stage.stampFrom) : null,
      detail: reached ? null : stage.pendingDetail,
    };
  });

  const delivered = status === 'DELIVERED';
  const inFulfilment = furthest >= 0 && !delivered && status !== 'CANCELLED';
  if (inFulfilment || (status === 'DELIVERY_FAILED' && furthest >= 0)) {
    const next = steps.find((step) => step.state === 'upcoming');
    if (next && status !== 'DELIVERY_FAILED') {
      next.state = 'current';
      if (status === 'PACKING' && next.key === 'packed') next.detail = 'Packing in progress.';
      if (status === 'SHIPPED' || status === 'PICKED_UP') next.detail = 'On its way to the delivery area.';
    }
  }

  let banner: ProgressBanner | null = null;
  let showSteps = furthest >= 0 && status !== 'CANCELLED';
  if (status === 'CANCELLED') {
    banner = { tone: 'error', title: 'Order cancelled', text: 'This order was cancelled. If you already paid, contact the shop with your payment details.' };
  } else if (status === 'DELIVERY_FAILED') {
    banner = { tone: 'warning', title: 'Delivery could not be completed', text: 'The shop will contact you to arrange a new delivery.' };
    showSteps = furthest >= 0;
  } else if (status === 'PENDING_PAYMENT') {
    banner = payment === 'REJECTED'
      ? { tone: 'warning', title: 'Payment proof was not accepted', text: 'Submit a new payment screenshot and UTR to continue.' }
      : { tone: 'info', title: 'Awaiting payment', text: 'Pay by UPI QR, then upload your screenshot and 12-digit UTR. Your order is not confirmed yet.' };
  } else if (status === 'PAYMENT_REVIEW') {
    banner = { tone: 'info', title: 'Payment verification pending', text: 'The shop is checking the bank credit for your payment. A screenshot alone does not confirm an order.' };
  } else if (status === 'AWAITING_CONFIRMATION') {
    banner = { tone: 'success', title: 'Payment verified', text: 'Your payment was verified. The shop will confirm your order next.' };
  }

  return { steps, banner, showSteps };
}
