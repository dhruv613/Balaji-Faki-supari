/* --- Order types --- */

export type ProductType = 'faki' | 'supari';
export type PackSize = '250g' | '500g' | '1kg';

export interface ProductInformation {
  ingredients: string;
  popularity: string;
  characteristics: string;
  productionPackaging: string;
  providerManufacturer: string;
  safetyStorage: string;
}

export type CanonicalOrderStatus =
  | 'PENDING_PAYMENT'
  | 'PAYMENT_REVIEW'
  | 'AWAITING_CONFIRMATION'
  | 'CONFIRMED'
  | 'PACKING'
  | 'PACKED'
  | 'PICKED_UP'
  | 'SHIPPED'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'DELIVERY_FAILED';

export type LegacyOrderStatus =
  | 'pending_payment'
  | 'verifying_payment'
  | 'active'
  | 'packing'
  | 'dispatched'
  | 'out_for_delivery'
  | 'delivered';

export type OrderStatus = CanonicalOrderStatus | LegacyOrderStatus;

export type CanonicalPaymentStatus =
  | 'PENDING'
  | 'SUBMITTED'
  | 'UNDER_REVIEW'
  | 'VERIFIED'
  | 'REJECTED';

export type LegacyPaymentStatus = 'pending' | 'verifying' | 'verified' | 'failed';

export type PaymentStatus = CanonicalPaymentStatus | LegacyPaymentStatus;

export const ORDER_STATUS_DISPLAY_LABELS: Record<OrderStatus, string> = {
  PENDING_PAYMENT: 'Awaiting Payment',
  PAYMENT_REVIEW: 'Payment Verification Pending',
  AWAITING_CONFIRMATION: 'Payment Verified — Awaiting Shop Confirmation',
  CONFIRMED: 'Order Confirmed',
  PACKING: 'Preparing Your Order',
  PACKED: 'Packed',
  PICKED_UP: 'Picked Up',
  SHIPPED: 'Shipped',
  OUT_FOR_DELIVERY: 'Out for Delivery',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
  DELIVERY_FAILED: 'Delivery Issue',
  pending_payment: 'Pending payment',
  verifying_payment: 'Verifying payment',
  active: 'Active',
  packing: 'Packing',
  dispatched: 'Dispatched',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
};

export interface Product {
  type: ProductType;
  name: string;
  nameGu: string; // Gujarati name
  category?: string;
  description?: string;
  imageUrl?: string;
  information?: ProductInformation;
  packSizes: PackSize[];
  /** Display-only placeholder prices — real prices come from the server */
  prices: Record<PackSize, number | null>;
}

export interface OrderFormData {
  product: ProductType;
  packSize: PackSize;
  quantity: number;
  fullName: string;
  phone: string;
  address: string;
  pinCode: string;
}

export interface OrderSummary {
  product: ProductType;
  productName: string;
  packSize: PackSize;
  quantity: number;
  subtotal: number | null;
  deliveryFee: number | null;
  total: number | null;
}

export interface Order {
  id: string;
  orderNumber: string;
  product: ProductType;
  productName: string;
  productImageUrl?: string | null;
  packSize: PackSize;
  quantity: number;
  subtotal: number;
  deliveryFee: number;
  total: number;
  customerName: string;
  phone: string;
  address: string;
  pinCode: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  utrNumber?: string | null;
  screenshotUrl?: string;
  createdAt: string;
  updatedAt: string;
  /** Returned by FastAPI when the order is created and awaiting payment. */
  payment?: PaymentInstructions | null;
}

/* --- Checkout / payment contracts (server is the source of truth) --- */

/** Request body for a server-side price quote. */
export interface CheckoutQuoteRequest {
  product: ProductType;
  packSize: PackSize;
  quantity: number;
  pinCode: string;
}

/** Server-calculated totals. The client never computes payable amounts. */
export interface CheckoutQuote {
  subtotal: number;
  deliveryFee: number;
  total: number;
  currency: 'INR';
}

/** Official payment destination for a specific order, issued by FastAPI. */
export interface PaymentInstructions {
  amount: number;
  payeeName: string;
  upiId: string;
  /** Official QR image URL (signed or public) — never generated in the browser. */
  qrImageUrl?: string;
  /** ISO timestamp after which the QR session expires. */
  expiresAt?: string;
}

export interface PaymentSubmissionResult {
  paymentId?: string;
  orderId?: string;
  orderNumber?: string;
  paymentStatus: PaymentStatus;
  orderStatus?: OrderStatus;
  utrMasked?: string;
  submittedAt?: string;
  message: string;
}

export interface PaymentStatusResponse {
  orderId: string;
  orderNumber: string;
  status: PaymentStatus;
  orderStatus: OrderStatus;
  message?: string;
  /** Masked UTR as stored on the server, e.g. 4XXXXXXXX912 */
  utrMasked?: string | null;
}

export interface TrackingEvent {
  status: string;
  label: string;
  timestamp: string;
  description: string;
}

export interface CustomerReview {
  id: string;
  customerName: string;
  area: string;
  rating: number;
  feedback: string;
  product: string;
  packSize: string;
  verified: boolean;
  createdAt: string;
}

export interface FAQItem {
  question: string;
  answer: string;
}

/* --- Admin types --- */

export interface AdminCustomer {
  id: string;
  name: string;
  initials: string;
  phone: string;
  location: string;
  orders: number;
  totalSpent: number;
  lastOrder: string;
  review: number | null;
  status: 'New' | 'Active' | 'Repeat' | 'Pending payment';
}
