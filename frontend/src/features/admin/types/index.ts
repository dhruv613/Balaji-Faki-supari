/**
 * Balaji Faki Point — Admin Panel Type Definitions
 *
 * Covers all 12 admin modules, strict state machines for Order, Payment,
 * Delivery, and Refund lifecycles, and typed FastAPI request/response contracts.
 */

import type {
  OrderStatus as CustomerOrderStatus,
  PaymentStatus as CustomerPaymentStatus,
  ProductType,
  PackSize,
  ProductInformation,
  AdminCustomer,
} from '../../../types/orders';

export type {
  CustomerOrderStatus,
  CustomerPaymentStatus,
  ProductType,
  PackSize,
  ProductInformation,
  AdminCustomer,
};

/* ================================================================== */
/*  1. ROLES & AUTHENTICATION                                         */
/* ================================================================== */

export type UserRole = 'CUSTOMER' | 'OWNER_ADMIN';

export interface AuthenticatedUserProfile {
  id: string;
  email: string;
  fullName: string;
  phone?: string;
  role: UserRole;
  isActive?: boolean;
  createdAt: string;
  lastSignInAt?: string;
}

/* ================================================================== */
/*  2. STRUCTURED STATE MACHINES (SECTION 6)                          */
/* ================================================================== */

/**
 * Structured Order Status State Machine.
 * Normal flow:
 * PENDING_PAYMENT -> PAYMENT_REVIEW -> AWAITING_CONFIRMATION -> CONFIRMED
 * -> PACKING -> PACKED -> PICKED_UP -> SHIPPED -> OUT_FOR_DELIVERY -> DELIVERED
 * Exceptional states: CANCELLED, DELIVERY_FAILED
 */
export type AdminOrderStatus =
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

/**
 * Separate Payment Status State Machine.
 * Never combined with order fulfillment or refund status.
 */
export type AdminPaymentStatus =
  | 'PENDING'
  | 'SUBMITTED'
  | 'UNDER_REVIEW'
  | 'VERIFIED'
  | 'REJECTED';

/**
 * Separate Refund Status State Machine.
 */
export type AdminRefundStatus =
  | 'NOT_REQUIRED'
  | 'PENDING'
  | 'APPROVED'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'FAILED';

/**
 * Fulfillment / Delivery lifecycle statuses controlled manually by Admin.
 */
export type AdminDeliveryStatus =
  | 'CONFIRMED'
  | 'PACKING'
  | 'PACKED'
  | 'PICKED_UP'
  | 'SHIPPED'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'DELIVERY_FAILED';

/* ================================================================== */
/*  3. PAGINATION & COMMON WRAPPERS                                   */
/* ================================================================== */

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface PaginationParams {
  page?: number;
  pageSize?: number;
  search?: string;
}

export interface AdminAuditEntry {
  id: string;
  action: string;
  entityType: 'ORDER' | 'PAYMENT' | 'PRODUCT' | 'INVENTORY' | 'DELIVERY' | 'REVIEW' | 'REFUND' | 'SETTINGS';
  entityId: string;
  actorId: string;
  actorEmail: string;
  timestamp: string;
  details: string;
}

/* ================================================================== */
/*  4. MODULE 01 — DASHBOARD                                          */
/* ================================================================== */

export type NetProfitStatus = 'OK' | 'NOT_CONFIGURED';

export interface AdminPendingConfirmation {
  paymentId: string;
  orderId: string;
  orderNumber: string;
  customerName: string;
  amount: number | null;
  utr: string;
  status: 'SUBMITTED' | 'UNDER_REVIEW';
  submittedAt: string;
}

/** The dashboard shows exactly three things; every figure is computed from real orders. */
export interface AdminDashboardResponse {
  productsSold: number;
  netProfit: {
    /** INR, or null when a required cost price is missing. */
    amount: number | null;
    status: NetProfitStatus;
    reason: string | null;
    note: string | null;
  };
  pendingPaymentConfirmations: AdminPendingConfirmation[];
}

/* ================================================================== */
/*  5. MODULE 02 — ORDER MANAGEMENT                                   */
/* ================================================================== */

export interface AdminOrderItem {
  id: string;
  productId: string;
  productType: ProductType;
  productName: string;
  productNameGu: string;
  productImage: string;
  packSize: PackSize;
  quantity: number;
  unitPrice: number | null;
  unitCostPrice?: number | null;
  lineTotal: number | null;
}

export interface AdminOrderTimelineEvent {
  id: string;
  status: AdminOrderStatus | AdminPaymentStatus;
  label: string;
  description: string;
  actorName: string;
  actorRole: UserRole | 'SYSTEM';
  timestamp: string;
}

export interface AdminOrderSummary {
  id: string;
  orderNumber: string;
  createdAt: string;
  updatedAt: string;
  customerName: string;
  customerEmail?: string;
  phone: string;
  area: string;
  pinCode: string;
  itemsSummary: string;
  totalAmount: number | null;
  paymentStatus: AdminPaymentStatus;
  orderStatus: AdminOrderStatus;
  refundStatus: AdminRefundStatus;
}

export interface AdminOrderDetail extends AdminOrderSummary {
  address: string;
  items: AdminOrderItem[];
  subtotal: number | null;
  deliveryCharges: number | null;
  customerNotes?: string;
  paymentDetails: {
    paymentId?: string;
    status: AdminPaymentStatus;
    utrNumber?: string;
    submittedAt?: string;
    verifiedAt?: string;
    verifiedBy?: string;
    bankCreditReference?: string;
    receivingBankAccount?: string;
    rejectionReason?: string;
  };
  timeline: AdminOrderTimelineEvent[];
}

export interface AdminOrdersQueryParams extends PaginationParams {
  orderId?: string;
  customerName?: string;
  phone?: string;
  status?: AdminOrderStatus | 'ALL';
  paymentStatus?: AdminPaymentStatus | 'ALL';
  dateFrom?: string;
  dateTo?: string;
}

export interface ConfirmOrderRequest {
  notes?: string;
}

export interface UpdateOrderStatusRequest {
  status: AdminOrderStatus;
  notes?: string;
  cancellationReason?: string;
  failureReason?: string;
}

/* ================================================================== */
/*  6. MODULE 03 — MANUAL PAYMENT VERIFICATION                        */
/* ================================================================== */

export interface BankCreditVerificationDetails {
  receivingBankAccount: string;
  verifiedAmount: number;
  verifiedUtr: string;
  transactionStatus: 'CREDITED' | 'PENDING_SETTLEMENT' | 'NOT_FOUND' | 'MISMATCH';
  bankCreditReference: string;
  bankTimestamp?: string;
  verifiedByAdmin?: string;
  verifiedAt?: string;
}

export interface PaymentVerificationHistoryItem {
  id: string;
  action: 'SUBMITTED' | 'UNDER_REVIEW' | 'BANK_CHECKED' | 'APPROVED' | 'REJECTED' | 'PROOF_REQUESTED';
  actorName: string;
  timestamp: string;
  notes: string;
}

export interface AdminPaymentSubmission {
  id: string;
  orderId: string;
  orderNumber: string;
  customerName: string;
  customerPhone: string;
  productSummary?: string;
  expectedAmount: number | null;
  submittedUtr: string;
  /** Private Supabase Storage object path; viewed only via short-lived signed URL from FastAPI */
  privateScreenshotPath: string;
  signedScreenshotUrl?: string;
  submissionDate: string;
  paymentStatus: AdminPaymentStatus;
  orderStatus: AdminOrderStatus;
  bankCredit?: BankCreditVerificationDetails;
  rejectionReason?: string;
  verificationHistory: PaymentVerificationHistoryItem[];
}

export interface AdminPaymentsQueryParams extends PaginationParams {
  status?: AdminPaymentStatus | 'ALL';
  dateFrom?: string;
  dateTo?: string;
}

export interface ApprovePaymentRequest {
  receivingBankAccount: string;
  verifiedAmount: number;
  verifiedUtr: string;
  transactionStatus: 'CREDITED';
  bankCreditReference: string;
  notes?: string;
}

export interface ReviewPaymentRequest {
  notes?: string;
}

export interface RejectPaymentRequest {
  reason: string;
  requestCorrectedProof?: boolean;
}

export interface AdminPaymentProofResponse {
  paymentId: string;
  orderId: string;
  privateStoragePath: string;
  signedUrl: string;
  expiresAt: string;
}

/* ================================================================== */
/*  7. MODULE 04 — PRODUCT & PRICE MANAGEMENT                         */
/* ================================================================== */

export interface AdminProductVariant {
  id: string;
  packSize: PackSize;
  sku: string;
  /** Product purchase/cost price stored separately from selling price */
  costPrice: number | null;
  /** Product selling price */
  price: number | null;
  availableQuantity: number;
  reservedQuantity: number;
  isAvailable: boolean;
}

export interface AdminProduct {
  id: string;
  type: ProductType;
  name: string;
  nameGu: string;
  category: string;
  description: string;
  descriptionGu?: string;
  imageUrl: string;
  information?: ProductInformation;
  active: boolean;
  variants: AdminProductVariant[];
  updatedAt: string;
}

export interface CreateAdminProductRequest {
  type: ProductType;
  name: string;
  nameGu: string;
  category: string;
  description: string;
  descriptionGu?: string;
  imageUrl: string;
  information?: ProductInformation;
  active: boolean;
  variants: Array<{
    packSize: PackSize;
    sku: string;
    costPrice?: number | null;
    price: number | null;
    availableQuantity: number;
    isAvailable: boolean;
  }>;
}

export interface UpdateAdminProductRequest {
  name?: string;
  nameGu?: string;
  category?: string;
  description?: string;
  descriptionGu?: string;
  imageUrl?: string;
  information?: ProductInformation;
  active?: boolean;
  variants?: Array<{
    id?: string;
    packSize: PackSize;
    costPrice?: number | null;
    price: number | null;
    availableQuantity?: number;
    isAvailable: boolean;
  }>;
}

/* ================================================================== */
/*  8. MODULE 05 — STOCK MANAGEMENT                                   */
/* ================================================================== */

export interface AdminInventoryItem {
  id: string;
  productId: string;
  productType: ProductType;
  productName: string;
  productNameGu: string;
  packSize: PackSize;
  sku: string;
  totalStock: number;
  availableStock: number;
  reservedStock: number;
  lowStockThreshold: number;
  isLowStock: boolean;
  reservationExpiryMinutes: number;
  updatedAt: string;
}

export type StockMovementType =
  | 'MANUAL_ADD'
  | 'MANUAL_DEDUCT'
  | 'ORDER_RESERVATION'
  | 'RESERVATION_RELEASED'
  | 'ORDER_CONFIRMED_DEDUCTION';

export interface StockMovementRecord {
  id: string;
  inventoryItemId: string;
  productName: string;
  packSize: PackSize;
  movementType: StockMovementType;
  quantityDelta: number;
  previousAvailable: number;
  newAvailable: number;
  reason: string;
  actorEmail: string;
  orderNumber?: string;
  createdAt: string;
}

export interface StockAdjustmentRequest {
  inventoryItemId: string;
  productId: string;
  packSize: PackSize;
  adjustmentType: 'ADD' | 'DEDUCT';
  quantity: number;
  reason: string;
}

export interface AdminInventoryResponse {
  summary: {
    totalStockUnits: number;
    availableStockUnits: number;
    reservedStockUnits: number;
    lowStockAlertsCount: number;
    reservationExpiryMinutes: number;
  };
  items: AdminInventoryItem[];
  movements: StockMovementRecord[];
}

/* ================================================================== */
/*  9. MODULE 06 — DELIVERY MANAGEMENT                                */
/* ================================================================== */

export interface DeliveryEventRecord {
  id: string;
  status: AdminDeliveryStatus;
  label: string;
  timestamp: string;
  actorName: string;
  notes: string;
}

export interface AdminDeliveryRecord {
  id: string;
  orderId: string;
  orderNumber: string;
  customerName: string;
  shippingAddress: string;
  pinCode: string;
  contactNumber: string;
  itemsSummary: string;
  status: AdminDeliveryStatus;
  assignedDeliveryPerson?: string;
  deliveryPhone?: string;
  courierTrackingReference?: string;
  dispatchDate?: string;
  pickupDate?: string;
  estimatedDeliveryDate?: string;
  deliveredDate?: string;
  deliveryNotes?: string;
  failureReason?: string;
  history: DeliveryEventRecord[];
  updatedAt: string;
}

export interface AdminDeliveriesQueryParams extends PaginationParams {
  status?: AdminDeliveryStatus | 'ALL';
  dateFrom?: string;
  dateTo?: string;
}

export interface UpdateDeliveryRequest {
  status?: AdminDeliveryStatus;
  assignedDeliveryPerson?: string;
  deliveryPhone?: string;
  courierTrackingReference?: string;
  dispatchDate?: string;
  pickupDate?: string;
  estimatedDeliveryDate?: string;
  deliveredDate?: string;
  deliveryNotes?: string;
  failureReason?: string;
}

/* ================================================================== */
/*  10. MODULE 07 — CUSTOMER MANAGEMENT                               */
/* ================================================================== */

export interface AdminCustomerOrderHistoryItem {
  orderId: string;
  orderNumber: string;
  date: string;
  itemsSummary: string;
  amount: number | null;
  paymentStatus: AdminPaymentStatus;
  orderStatus: AdminOrderStatus;
}

export interface AdminCustomerReviewItem {
  id: string;
  orderNumber: string;
  rating: number;
  feedback: string;
  createdAt: string;
}

export interface AdminCustomerDetailRecord extends AdminCustomer {
  email?: string;
  fullAddress?: string;
  pinCode?: string;
  joinedDate?: string;
  orderHistory: AdminCustomerOrderHistoryItem[];
  reviews: AdminCustomerReviewItem[];
}

export interface AdminCustomersQueryParams extends PaginationParams {
  area?: string;
  status?: 'all' | 'new' | 'repeat' | 'pending';
}

/* ================================================================== */
/*  11. MODULE 08 — REVIEWS & FEEDBACK                                */
/* ================================================================== */

export type ReviewModerationStatus = 'PUBLISHED' | 'HIDDEN' | 'PENDING_MODERATION';

export interface AdminReviewRecord {
  id: string;
  orderId: string;
  orderNumber: string;
  customerName: string;
  customerEmail?: string;
  area: string;
  productName: string;
  packSize: PackSize;
  rating: number;
  reviewText: string;
  createdAt: string;
  isEligibleDeliveredOrder: boolean;
  moderationStatus: ReviewModerationStatus;
  adminReply?: string;
  adminRepliedAt?: string;
  moderatedBy?: string;
  /** Short-lived FastAPI proxy paths for review photo moderation. */
  photoUrls?: string[];
}

export interface AdminReviewsQueryParams extends PaginationParams {
  rating?: number | 'ALL';
  moderationStatus?: ReviewModerationStatus | 'ALL';
}

export interface UpdateAdminReviewRequest {
  moderationStatus?: ReviewModerationStatus;
  adminReply?: string;
}

/* ================================================================== */
/*  12. MODULE 09 — CANCELLATIONS & REFUNDS                           */
/* ================================================================== */

export interface AdminRefundRecord {
  id: string;
  orderId: string;
  orderNumber: string;
  customerName: string;
  customerPhone: string;
  cancelledAt: string;
  cancellationRequestedBy: 'CUSTOMER' | 'ADMIN';
  refundAmount: number | null;
  refundReason: string;
  originalPaymentUtr: string;
  originalPaymentId: string;
  refundTransactionReference?: string;
  refundBankAccount?: string;
  refundDate?: string;
  refundStatus: AdminRefundStatus;
  approvedBy?: string;
  approvedAt?: string;
  completedBy?: string;
  notes?: string;
}

export interface AdminRefundsQueryParams extends PaginationParams {
  status?: AdminRefundStatus | 'ALL';
  dateFrom?: string;
  dateTo?: string;
}

export interface ApproveRefundRequest {
  notes?: string;
}

export interface RecordRefundTransferRequest {
  refundTransactionReference: string;
  refundBankAccount: string;
  refundDate: string;
  verifiedAmount: number;
  notes?: string;
}

/* ================================================================== */
/*  13. MODULE 10 — REPORTS & EXPORTS                                 */
/* ================================================================== */

export type AdminReportCategory =
  | 'DAILY_SALES'
  | 'WEEKLY_SALES'
  | 'MONTHLY_SALES'
  | 'ORDERS_BY_STATUS'
  | 'PRODUCT_SALES'
  | 'PAYMENT_VERIFICATION_SUMMARY'
  | 'REFUND_SUMMARY'
  | 'CUSTOMER_SUMMARY'
  | 'INVENTORY_SUMMARY';

export interface AdminReportsQueryParams {
  category: AdminReportCategory;
  dateFrom: string;
  dateTo: string;
  product?: ProductType | 'ALL';
  paymentStatus?: AdminPaymentStatus | 'ALL';
  orderStatus?: AdminOrderStatus | 'ALL';
}

export interface AdminReportRow {
  id: string;
  periodOrDimension: string;
  ordersCount: number;
  verifiedReceiptsAmount: number | null;
  deliveredSalesAmount: number | null;
  completedRefundsAmount: number | null;
  unitsSold: number;
  notes?: string;
}

export interface AdminReportResponse {
  category: AdminReportCategory;
  generatedAt: string;
  dateFrom: string;
  dateTo: string;
  summary: {
    totalOrders: number;
    verifiedPaymentReceipts: number | null;
    deliveredOrderSales: number | null;
    completedRefunds: number | null;
    unverifiedSubmissionsExcluded: number;
  };
  rows: AdminReportRow[];
}

/* ================================================================== */
/*  14. MODULE 11 — CUSTOMER NOTIFICATIONS                            */
/* ================================================================== */

export type NotificationTriggerEvent =
  | 'PAYMENT_PROOF_SUBMITTED'
  | 'PAYMENT_VERIFIED'
  | 'PAYMENT_REJECTED'
  | 'ORDER_CONFIRMED'
  | 'ORDER_PACKED'
  | 'ORDER_PICKED_UP'
  | 'ORDER_SHIPPED'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'ORDER_CANCELLED'
  | 'REFUND_STATUS_UPDATED';

export type NotificationChannel = 'EMAIL' | 'IN_APP' | 'WHATSAPP_FUTURE';

export type EmailDeliveryStatus = 'SENT' | 'DELIVERED' | 'QUEUED_POST_COMMIT' | 'FAILED';

export interface AdminNotificationLog {
  id: string;
  orderId: string;
  orderNumber: string;
  customerName: string;
  recipientEmail: string;
  trigger: NotificationTriggerEvent;
  channel: NotificationChannel;
  subject: string;
  deliveryStatus: EmailDeliveryStatus;
  errorMessage?: string;
  retryCount: number;
  dispatchedAt: string;
}

export interface NotificationTemplateItem {
  id: string;
  trigger: NotificationTriggerEvent;
  name: string;
  channel: NotificationChannel;
  subjectTemplate: string;
  bodyTemplate: string;
  enabled: boolean;
}

export interface AdminNotificationsQueryParams extends PaginationParams {
  trigger?: NotificationTriggerEvent | 'ALL';
  deliveryStatus?: EmailDeliveryStatus | 'ALL';
}

export interface AdminNotificationsResponse {
  logs: AdminNotificationLog[];
  templates: NotificationTemplateItem[];
  settings: {
    emailEnabled: boolean;
    inWebsiteUpdatesEnabled: boolean;
    whatsappFuturePrepared: boolean;
    dispatchAfterTransactionCommitOnly: boolean;
  };
}

/* ================================================================== */
/*  15. MODULE 12 — STORE SETTINGS                                    */
/* ================================================================== */

export interface AdminStorePhoto {
  id: string;
  url: string;
  caption: string;
}

/** Shop details, payment destination and delivery rules, all stored in the database. */
export interface AdminStoreSettings {
  storeName: string;
  storeNameGu?: string;
  tagline: string;
  storeAddress: string;
  phoneNumber: string;
  supportWhatsapp: string;
  supportEmail: string;
  businessHours: string;
  shopIntro: string;
  productionInfo: string;
  providerManufacturer: string;
  packagingInfo: string;
  photos: AdminStorePhoto[];
  officialUpiId: string;
  officialPayeeName: string;
  /** Short-lived signed path for the private payment QR; empty when none is uploaded. */
  officialUpiQrImageUrl: string;
  deliveryCharges: number | null;
  freeDeliveryThreshold: number | null;
  serviceablePinCodes: string[];
  lowStockThreshold: number;
  stockReservationExpiryMinutes: number;
  /** null until the owner confirms payment, delivery and PIN settings; checkout stays closed outside local mode. */
  businessSettingsConfirmedAt: string | null;
  /** true while the UPI ID is a LOCAL TEST value. */
  paymentIsLocalTest: boolean;
  adminAccount: { email: string; role: UserRole };
}

export type UpdateAdminSettingsRequest = Partial<
  Pick<
    AdminStoreSettings,
    | 'storeName' | 'storeNameGu' | 'tagline' | 'storeAddress' | 'phoneNumber' | 'supportWhatsapp' | 'supportEmail'
    | 'businessHours' | 'shopIntro' | 'productionInfo' | 'providerManufacturer' | 'packagingInfo'
    | 'officialUpiId' | 'officialPayeeName' | 'deliveryCharges' | 'freeDeliveryThreshold' | 'serviceablePinCodes'
    | 'lowStockThreshold' | 'stockReservationExpiryMinutes'
  >
>;
