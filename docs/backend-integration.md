# FastAPI and Supabase Integration Contract

Status: Prepared frontend contract (not a claim of an implemented backend). Keep the existing feature API modules (`src/features/*/api/*` and `src/features/admin/api/index.ts`); all calls use `src/lib/api.ts` and `VITE_API_BASE_URL`. Wire names are camelCase, amounts are INR numbers with at most two decimal places, and statuses follow strict state machines enforced both in the frontend (`src/features/admin/lib/orderStateMachine.ts`) and in FastAPI.

---

## 1. Authentication & Role-Based Authorization

### Customer Authentication
The customer signs in through Supabase email/password. Configure `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, enable the Email provider, and configure email confirmation/delivery and Site URL/allowed redirect URLs. Account creation does not unlock the store while email confirmation is required. All customer routes wait for a session, then require full name and Indian mobile contact details before mounting the store. The original route/query is preserved through this gate.

The frontend saves `user_metadata.fullName` and `user_metadata.phone` using `supabase.auth.updateUser({ data: ... })`; phone is stored as `+91` followed by 10 digits. UI mobile inputs accept at most 10 national digits starting with 6–9; name is 2–100 characters. These are editable, unverified contact details, not authorization claims. FastAPI must validate these inputs again. No database or privileged Supabase operation is called from React.

### Admin Authorization (`OWNER_ADMIN` vs `CUSTOMER`)
- **Roles**: `CUSTOMER` and `OWNER_ADMIN` (stored in PostgreSQL `user_profiles.role`, NOT in editable client `user_metadata`).
- The frontend sends `Authorization: Bearer <Supabase access token>` to FastAPI on every request.
- FastAPI must verify the Supabase JWT signature, issuer, audience, and expiry, and query `user_profiles` by `auth.uid()` to check `role == 'OWNER_ADMIN'` and `is_active == TRUE`.
- `GET /api/me` returns `{ id, email, fullName, phone, role: 'OWNER_ADMIN' | 'CUSTOMER', isActive }`.
- Every `/api/admin/*` route requires `role == 'OWNER_ADMIN'`. If a `CUSTOMER` or unauthenticated user calls `/api/admin/*`, FastAPI must return `401 Unauthorized` or `403 Forbidden`.
- In the React frontend, `AdminRouteGuard` (`src/features/admin/components/AdminRouteGuard.tsx`) verifies the session and calls `GET /api/me`, blocking `CUSTOMER` accounts from accessing `/admin/*`.

---

## 2. Customer-Facing Endpoints

| Method | Path | Input | Response |
| --- | --- | --- | --- |
| GET | `/products` | Public catalog request | `Product[]`: type, name, nameGu, supported packSizes, prices. Null means unavailable; 0 is a real zero price. |
| POST | `/checkout/quote` | `CheckoutQuoteRequest`: product, packSize, quantity, pinCode | `CheckoutQuote`: subtotal, deliveryFee, total, currency `'INR'` |
| POST | `/orders` | `OrderFormData`: product, packSize, quantity, fullName, phone, address, pinCode; `Idempotency-Key` header | Complete `Order`, real id/orderNumber, recalculated totals, official `payment` instructions |
| GET | `/orders` | Authenticated session, no arbitrary phone lookup | Customer's `Order[]` |
| GET | `/orders/{idOrNumber}` | Owned ID or displayed order number | Complete `Order` |
| GET | `/orders/{idOrNumber}/tracking` | Owned ID or displayed order number | `{ events: TrackingEvent[] }` |
| POST | `/payments/{orderId}/submit` | Multipart `utr`, `screenshot`; `Idempotency-Key` header | `PaymentSubmissionResult`: paymentStatus and message; received does not mean verified |
| GET | `/payments/{orderId}/status` | Owned real order ID | `PaymentStatusResponse`: orderId, orderNumber, status, orderStatus, optional message/utrMasked |

---

## 3. Admin Management Panel Endpoints (`/api/admin/*`)

All admin endpoints require `Authorization: Bearer <JWT>` belonging to an active `OWNER_ADMIN`. Mutating endpoints accept an `Idempotency-Key` header and must write an immutable record to `admin_audit_logs`.

| Method | Path | Module | Input / Query | Response & Server Invariants |
| --- | --- | --- | --- | --- |
| GET | `/api/me` | Auth | Bearer JWT | `AdminIdentity`: `{ id, email, fullName, phone, role, isActive }` |
| GET | `/api/admin/dashboard` | 01 Dashboard | — | `DashboardOverviewResponse`: metrics (`totalOrders`, `todaysOrders`, `verifiedPaymentReceiptsAmount`, `pendingPaymentsCount`, `awaitingConfirmationCount`, `packingOrdersCount`, `packedOrdersCount`, `outForDeliveryCount`, `deliveredOrdersCount`, `pendingRefundsCount`, `lowStockProductsCount`, `completedRefundsAmount`, `deliveredOrderSalesAmount`), `recentOrders`, `recentPayments`, `salesChart`, `statusDistribution`, `recentActivity`, `attentionOrders`. **Rule**: `verifiedPaymentReceiptsAmount` and `deliveredOrderSalesAmount` must exclude unverified screenshot submissions. |
| GET | `/api/admin/orders` | 02 Orders | `search`, `status`, `paymentStatus`, `dateFrom`, `dateTo`, `page`, `pageSize` | `PaginatedResponse<AdminOrder>` |
| GET | `/api/admin/orders/{id}` | 02 Orders | Path `id` | `AdminOrder` including `items`, `payment`, `timeline`, `delivery` |
| POST | `/api/admin/orders/{id}/confirm` | 02 Orders | `{ notes? }` | Transitions `AWAITING_CONFIRMATION` → `CONFIRMED`. **Enforce**: `payment.status == 'VERIFIED'`, available stock >= order item quantities, reserve/commit stock atomically. |
| POST | `/api/admin/orders/{id}/status` | 02 Orders | `{ targetStatus, notes?, reason? }` | Enforces strict state machine (`validateOrderTransition`). Packing (`PACKING`) cannot start unless `CONFIRMED` and `payment.status == 'VERIFIED'`. Cancelled orders release reserved stock. |
| GET | `/api/admin/payments` | 03 Payments | `status`, `search` | `AdminPaymentSubmission[]` |
| GET | `/api/admin/payments/{id}` | 03 Payments | Path `id` | `AdminPaymentSubmission` with short-lived signed screenshot URL (`expiresIn <= 300s`) from private Supabase Storage bucket |
| POST | `/api/admin/payments/{id}/approve` | 03 Payments | `PaymentApprovalRequest`: `{ paymentId, orderId, submittedUtr, verifiedBankAccount, verifiedAmountInr, bankCreditRef, bankTransactionStatus: 'CREDITED', adminNotes? }` | **Atomic Transaction**: Verify `verifiedAmountInr == expectedAmountInr`, `submittedUtr` matches and is not already verified (`UNIQUE`), `bankCreditRef` is not already assigned (`UNIQUE`). Sets `payment.status = 'VERIFIED'` and `order.status = 'AWAITING_CONFIRMATION'`. **Never** transitions order directly to `PACKING` or `SHIPPED`. |
| POST | `/api/admin/payments/{id}/reject` | 03 Payments | `{ paymentId, orderId, reason, notes? }` | Sets `payment.status = 'REJECTED'`, logs audit trail |
| POST | `/api/admin/payments/{id}/request-proof` | 03 Payments | `{ paymentId, orderId, messageToCustomer }` | Sets `payment.status = 'PROOF_REQUESTED'` and queues customer notification |
| GET | `/api/admin/products` | 04 Products | — | `AdminProduct[]` with `variants` (`250g`, `500g`, `1kg`) |
| POST | `/api/admin/products` | 04 Products | `CreateProductRequest` | Creates product and initial variants |
| PATCH | `/api/admin/products/{id}` | 04 Products | `UpdateProductRequest` | Updates product details, active status, variant prices (`null` = unavailable), and availability |
| GET | `/api/admin/inventory` | 05 Inventory | — | `{ items: InventoryItem[], movements: StockMovementRecord[] }` |
| POST | `/api/admin/inventory/adjust` | 05 Inventory | `StockAdjustmentRequest`: `{ variantId, movementType, quantityDelta, reason, referenceOrderId? }` | **Enforce**: `availableStock + quantityDelta >= 0` (never allow negative available stock), require non-empty `reason`, record acting admin in `inventory_movements`. |
| GET | `/api/admin/deliveries` | 06 Delivery | `status`, `search` | `DeliveryAssignment[]` |
| PATCH | `/api/admin/deliveries/{orderId}` | 06 Delivery | `UpdateDeliveryRequest`: `{ orderId, targetStatus, assignedDeliveryPerson?, deliveryPhone?, courierName?, trackingReference?, estimatedDeliveryDate?, deliveryNotes?, failureReason? }` | Enforces strict delivery transitions (`CONFIRMED` → `PACKING` → `PACKED` → `PICKED_UP` → `SHIPPED` → `OUT_FOR_DELIVERY` → `DELIVERED` or `DELIVERY_FAILED`), appends immutable `delivery_events` record. |
| GET | `/api/admin/customers` | 07 Customers | `search`, `area`, `segment` | `AdminCustomer[]` |
| GET | `/api/admin/customers/{id}` | 07 Customers | Path `id` | `AdminCustomer` with `orderHistory` and `reviews` |
| GET | `/api/admin/reviews` | 08 Reviews | `status`, `rating`, `search` | `AdminReviewItem[]` |
| PATCH | `/api/admin/reviews/{id}` | 08 Reviews | `{ reviewId, moderationStatus, moderationReason?, adminReply? }` | Updates review visibility (`PUBLISHED`, `HIDDEN`, `FLAGGED`) and admin reply. Only delivered orders are eligible for verified-purchase reviews. |
| GET | `/api/admin/refunds` | 09 Refunds | — | `{ cancellations: CancellationRequestItem[], refunds: AdminRefundItem[] }` |
| POST | `/api/admin/refunds/{id}/status` | 09 Refunds | `UpdateRefundStatusRequest`: `{ refundId, orderId, targetStatus, refundBankRef?, verifiedBankAccount?, refundDate?, verifiedAmountInr?, notes? }` | **Rule**: Cannot mark `COMPLETED` unless `refundBankRef`, `verifiedBankAccount`, `refundDate`, and exact `verifiedAmountInr` are provided and verified. Refund records remain separate from original `payment_attempts`. |
| GET | `/api/admin/reports` | 10 Reports | `dateFrom`, `dateTo`, `productType`, `paymentStatus`, `orderStatus` | `ReportsSummaryResponse`: daily/weekly/monthly sales, orders by status, product sales, payment verification summary, refund summary, customer summary, inventory summary. Calculated strictly from verified database records. |
| GET | `/api/admin/notifications` | 11 Notifications | `eventType`, `status`, `search` | `NotificationLogItem[]` |
| POST | `/api/admin/notifications/{id}/send` | 11 Notifications | `{ notificationId, channel, customMessage? }` | Triggers or retries transactional notification and records status |
| GET | `/api/admin/settings` | 12 Settings | — | `StoreSettings` |
| PATCH | `/api/admin/settings` | 12 Settings | `Partial<StoreSettings>` | Updates store contact details, delivery charges, free-delivery threshold, serviceable PIN codes, low-stock threshold, and operating hours |

---

## 4. State Machine Invariants

1. **Order Status (`AdminOrderStatus`)**:
   - `PENDING_PAYMENT` → `PAYMENT_SUBMITTED` or `CANCELLED`
   - `PAYMENT_SUBMITTED` → `PAYMENT_VERIFIED`, `AWAITING_CONFIRMATION`, or `CANCELLED`
   - `PAYMENT_VERIFIED` → `AWAITING_CONFIRMATION` or `CANCELLED`
   - `AWAITING_CONFIRMATION` → `CONFIRMED` (requires `payment.status == 'VERIFIED'`) or `CANCELLED`
   - `CONFIRMED` → `PACKING` (requires `payment.status == 'VERIFIED'`) or `CANCELLED`
   - `PACKING` → `PACKED` or `CANCELLED`
   - `PACKED` → `PICKED_UP` or `SHIPPED`
   - `PICKED_UP` → `SHIPPED` or `OUT_FOR_DELIVERY`
   - `SHIPPED` → `OUT_FOR_DELIVERY` or `DELIVERED`
   - `OUT_FOR_DELIVERY` → `DELIVERED` or `DELIVERY_FAILED`
   - `DELIVERY_FAILED` → `OUT_FOR_DELIVERY` or `CANCELLED`
   - `DELIVERED` and `CANCELLED` are terminal states.
2. **Payment Verification Separation**:
   - Approving a payment sets `payment_status = 'VERIFIED'` and `order_status = 'AWAITING_CONFIRMATION'`.
   - Payment approval and Order Confirmation (`AWAITING_CONFIRMATION` → `CONFIRMED`) are strictly separate administrative steps.

---

## 5. Required PostgreSQL / Supabase Database Schema (18 Tables)

Manage schema migrations through **Alembic** in the FastAPI repository:

1. `user_profiles`: `id (UUID PK -> auth.users)`, `email`, `full_name`, `phone`, `role ('CUSTOMER' | 'OWNER_ADMIN')`, `is_active`, `created_at`, `updated_at`
2. `customers`: `id (UUID PK)`, `user_id (UUID FK)`, `full_name`, `phone`, `email`, `area`, `address`, `pin_code`, `order_count`, `total_spent_paise`, `created_at`
3. `products`: `id (UUID PK)`, `slug ('faki' | 'supari' UNIQUE)`, `name`, `name_gu`, `category`, `description`, `image_url`, `is_active`, `created_at`, `updated_at`
4. `product_variants`: `id (UUID PK)`, `product_id (UUID FK)`, `pack_size ('250g' | '500g' | '1kg')`, `sku (UNIQUE)`, `price_paise (NULLABLE INT)`, `is_available`, `total_stock`, `reserved_stock`, `low_stock_threshold`, `updated_at`
5. `orders`: `id (UUID PK)`, `order_number (UNIQUE)`, `customer_id (UUID FK)`, `status`, `payment_status`, `delivery_status`, `subtotal_paise`, `delivery_fee_paise`, `total_paise`, `shipping_name`, `shipping_phone`, `shipping_address`, `shipping_pin_code`, `customer_notes`, `idempotency_key (UNIQUE)`, `confirmed_by (UUID FK)`, `confirmed_at`, `cancelled_by (UUID FK)`, `cancelled_at`, `cancellation_reason`, `created_at`, `updated_at`
6. `order_items`: `id (UUID PK)`, `order_id (UUID FK)`, `product_id (UUID FK)`, `variant_id (UUID FK)`, `product_name`, `pack_size`, `quantity`, `unit_price_paise`, `line_total_paise`
7. `payment_attempts`: `id (UUID PK)`, `order_id (UUID FK)`, `expected_amount_paise`, `submitted_utr`, `verified_utr (UNIQUE WHERE status = 'VERIFIED')`, `screenshot_storage_path`, `status ('PENDING' | 'SUBMITTED' | 'UNDER_REVIEW' | 'VERIFIED' | 'REJECTED' | 'PROOF_REQUESTED')`, `idempotency_key (UNIQUE)`, `verified_by (UUID FK)`, `verified_at`, `rejection_reason`, `admin_notes`, `submitted_at`
8. `bank_credits`: `id (UUID PK)`, `payment_attempt_id (UUID FK UNIQUE)`, `bank_credit_ref (UNIQUE)`, `verified_bank_account`, `utr (UNIQUE)`, `credited_amount_paise`, `transaction_status ('CREDITED')`, `verified_by (UUID FK)`, `verified_at`
9. `order_status_history`: `id (UUID PK)`, `order_id (UUID FK)`, `from_status`, `to_status`, `actor_id (UUID FK)`, `actor_name`, `actor_role`, `note`, `created_at`
10. `inventory_movements`: `id (UUID PK)`, `variant_id (UUID FK)`, `movement_type ('INITIAL_STOCK' | 'MANUAL_ADDITION' | 'MANUAL_DEDUCTION' | 'ORDER_RESERVED' | 'ORDER_COMMITTED' | 'RESERVATION_RELEASED' | 'DAMAGED_SPOILED')`, `quantity_delta`, `previous_available`, `new_available`, `reason`, `reference_order_id (UUID FK NULLABLE)`, `actor_id (UUID FK)`, `created_at`
11. `shipments`: `id (UUID PK)`, `order_id (UUID FK UNIQUE)`, `delivery_status`, `assigned_delivery_person`, `delivery_phone`, `courier_name`, `tracking_reference`, `dispatch_date`, `pickup_date`, `estimated_delivery_date`, `delivered_date`, `delivery_notes`, `failure_reason`, `updated_at`
12. `delivery_events`: `id (UUID PK)`, `shipment_id (UUID FK)`, `order_id (UUID FK)`, `status`, `label`, `note`, `actor_id (UUID FK)`, `actor_name`, `created_at`
13. `reviews`: `id (UUID PK)`, `order_id (UUID FK UNIQUE)`, `customer_id (UUID FK)`, `product_id (UUID FK)`, `rating (1..5)`, `review_text`, `is_verified_purchase`, `moderation_status ('PUBLISHED' | 'HIDDEN' | 'PENDING_MODERATION' | 'FLAGGED')`, `moderation_reason`, `admin_reply`, `admin_replied_at`, `moderated_by (UUID FK)`, `created_at`
14. `cancellation_requests`: `id (UUID PK)`, `order_id (UUID FK)`, `requested_by_role`, `reason`, `status ('PENDING' | 'APPROVED' | 'REJECTED')`, `reviewed_by (UUID FK)`, `reviewed_at`, `review_notes`, `created_at`
15. `refunds`: `id (UUID PK)`, `order_id (UUID FK)`, `original_payment_id (UUID FK)`, `original_payment_utr`, `refund_amount_paise`, `reason`, `status ('NOT_REQUIRED' | 'PENDING' | 'APPROVED' | 'PROCESSING' | 'COMPLETED' | 'FAILED')`, `refund_bank_ref (UNIQUE NULLABLE)`, `verified_bank_account`, `refund_date`, `verified_by (UUID FK)`, `verified_at`, `notes`, `created_at`, `updated_at`
16. `notifications`: `id (UUID PK)`, `order_id (UUID FK)`, `customer_id (UUID FK)`, `event_type`, `channel ('EMAIL' | 'SMS' | 'WHATSAPP' | 'IN_APP')`, `status ('QUEUED' | 'SENT' | 'DELIVERED' | 'FAILED')`, `subject`, `body_preview`, `error_message`, `sent_by (UUID FK)`, `sent_at`, `created_at`
17. `store_settings`: `id (INT PK DEFAULT 1)`, `store_name`, `tagline`, `support_phone`, `support_whatsapp`, `support_email`, `store_address`, `city`, `state`, `pin_code`, `opening_hours`, `upi_payee_name`, `upi_id`, `qr_code_storage_path`, `standard_delivery_fee_paise`, `free_delivery_threshold_paise`, `serviceable_pin_codes (JSONB)`, `low_stock_default_threshold`, `reservation_expiry_minutes`, `updated_by (UUID FK)`, `updated_at`
18. `admin_audit_logs`: `id (UUID PK)`, `actor_id (UUID FK)`, `actor_email`, `action`, `entity_type`, `entity_id`, `previous_state (JSONB)`, `new_state (JSONB)`, `ip_address`, `idempotency_key`, `created_at`

### Private Supabase Storage Bucket
- Bucket name: `payment-proofs` (`public = false`).
- Customers upload only through `POST /payments/{orderId}/submit` on FastAPI (which validates MIME type `image/jpeg`, `image/png`, `image/webp`, max size `5 MB`, and ownership).
- Administrators view screenshots only via short-lived signed URLs (`expiresIn <= 300` seconds) generated by FastAPI on `GET /api/admin/payments/{id}` after verifying `OWNER_ADMIN` role. Never expose public URLs for payment screenshots.
