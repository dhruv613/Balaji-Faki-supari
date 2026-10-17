# API Contracts — Customer & Admin Endpoints

All frontend HTTP calls go through [`src/lib/api.ts`](../../src/lib/api.ts) (`apiFetch`) using `VITE_API_BASE_URL` (e.g., `http://localhost:8000/api` in development).

- **Authentication Header**: `Authorization: Bearer <access_token>`
- **Idempotency**: Mutating endpoints accept `Idempotency-Key: <unique-key>`
- **Timeout**: 15,000 ms (`AbortSignal.timeout(15_000)`)
- **Error Format**: FastAPI JSON `{ "detail": "Human-readable error message" }` or validation array `{ "detail": [{ "msg": "..." }] }`

---

## 1. Customer Store Endpoints (`src/features/*/api/*`)

| Method | Path | Request Body / Params | Response Contract |
| --- | --- | --- | --- |
| `GET` | `/products` | — | `Product[]` (`type`, `name`, `nameGu`, `packSizes`, `prices` where `null` = awaiting price) |
| `POST` | `/checkout/quote` | `{ product, packSize, quantity, pinCode }` | `{ subtotal, deliveryFee, total, currency: 'INR' }` (`total === subtotal + deliveryFee`) |
| `POST` | `/orders` | `OrderFormData` + `Idempotency-Key` | `Order` with server-calculated totals and official `payment` instructions (`amount`, `payeeName`, `upiId`, `qrImageUrl?`, `expiresAt?`) |
| `GET` | `/orders` | Authenticated user | `Order[]` owned by the caller |
| `GET` | `/orders/{idOrNumber}` | Path `idOrNumber` | `Order` (ownership verified on server) |
| `GET` | `/orders/{idOrNumber}/tracking` | Path `idOrNumber` | `{ events: TrackingEvent[] }` |
| `POST` | `/payments/{orderId}/submit` | `multipart/form-data`: `utr` (12 digits), `screenshot` (`image/jpeg\|png\|webp`, max 5 MB) + `Idempotency-Key` | `{ paymentStatus: 'verifying', message }` (submission is receipt of proof only, never auto-verified) |
| `GET` | `/payments/{orderId}/status` | Path `orderId` | `{ orderId, orderNumber, status, orderStatus, message?, utrMasked? }` |

---

## 2. Admin Panel Endpoints (`src/features/admin/api/index.ts`)

Every `/api/admin/*` endpoint requires an authenticated `OWNER_ADMIN` user (`user_profiles.role == 'OWNER_ADMIN'`) and writes an entry to `public.admin_audit_logs`.

| Method | Path | Module | Request / Query | Response & Invariants |
| --- | --- | --- | --- | --- |
| `GET` | `/api/me` | Auth | Bearer token | `AuthenticatedUserProfile` (`id`, `email`, `fullName`, `phone`, `role`) |
| `GET` | `/api/admin/dashboard` | 01 Dashboard | — | `AdminDashboardResponse` (excludes unverified screenshot submissions from revenue) |
| `GET` | `/api/admin/orders` | 02 Orders | `search`, `status`, `paymentStatus`, `dateFrom`, `dateTo`, `page`, `pageSize` | `PaginatedResponse<AdminOrderSummary>` |
| `GET` | `/api/admin/orders/{id}` | 02 Orders | Path `id` | `AdminOrderDetail` |
| `POST` | `/api/admin/orders/{id}/confirm` | 02 Orders | `{ note? }` + `Idempotency-Key` | Transitions `AWAITING_CONFIRMATION` → `CONFIRMED` (requires `paymentStatus === 'VERIFIED'` and sufficient stock) |
| `PATCH` | `/api/admin/orders/{id}/status` | 02 Orders | `{ nextStatus, note?, cancellationReason? }` | Enforces `validateOrderTransition` state machine |
| `GET` | `/api/admin/payments` | 03 Payments | `search`, `status`, `dateFrom`, `dateTo`, `page` | `PaginatedResponse<AdminPaymentSubmission>` |
| `GET` | `/api/admin/payments/{id}` | 03 Payments | Path `id` | `AdminPaymentSubmission` with short-lived signed screenshot URL from private `payment-proofs` bucket |
| `POST` | `/api/admin/payments/{id}/approve` | 03 Payments | `ApprovePaymentRequest` (`receivingBankAccount`, `verifiedAmount`, `verifiedUtr`, `bankCreditReference`, `transactionStatus: 'CREDITED'`) | Atomically sets `payment_status = 'VERIFIED'` and `order.status = 'AWAITING_CONFIRMATION'`. Rejects duplicate UTRs and duplicate bank credit references. |
| `POST` | `/api/admin/payments/{id}/reject` | 03 Payments | `RejectPaymentRequest` (`reason`, `requestCorrectedProof`, `note?`) | Sets `payment_status = 'REJECTED'` |
| `GET` | `/api/admin/products` | 04 Products | — | `AdminProduct[]` with `variants` (`250g`, `500g`, `1kg`) |
| `POST` | `/api/admin/products` | 04 Products | `CreateAdminProductRequest` | `AdminProduct` |
| `PATCH` | `/api/admin/products/{id}` | 04 Products | `UpdateAdminProductRequest` | `AdminProduct` |
| `GET` | `/api/admin/inventory` | 05 Inventory | — | `AdminInventoryResponse` (`variants`, `movements`, `lowStockCount`) |
| `POST` | `/api/admin/inventory/adjustments` | 05 Inventory | `StockAdjustmentRequest` (`variantId`, `adjustmentType`, `quantity`, `reason`) | `StockMovementRecord` (never allows negative available stock) |
| `GET` | `/api/admin/deliveries` | 06 Delivery | `search`, `status`, `page` | `PaginatedResponse<AdminDeliveryRecord>` |
| `PATCH` | `/api/admin/deliveries/{id}` | 06 Delivery | `UpdateDeliveryRequest` | `AdminDeliveryRecord` + immutable `delivery_events` entry |
| `GET` | `/api/admin/customers` | 07 Customers | `search`, `area`, `segment`, `page` | `PaginatedResponse<AdminCustomer>` |
| `GET` | `/api/admin/customers/{id}` | 07 Customers | Path `id` | `AdminCustomerDetailRecord` |
| `GET` | `/api/admin/reviews` | 08 Reviews | `search`, `rating`, `moderationStatus`, `page` | `PaginatedResponse<AdminReviewRecord>` |
| `PATCH` | `/api/admin/reviews/{id}` | 08 Reviews | `UpdateAdminReviewRequest` | `AdminReviewRecord` |
| `GET` | `/api/admin/refunds` | 09 Refunds | `search`, `status`, `page` | `PaginatedResponse<AdminRefundRecord>` |
| `POST` | `/api/admin/refunds/{id}/approve` | 09 Refunds | `ApproveRefundRequest` | `AdminRefundRecord` |
| `POST` | `/api/admin/refunds/{id}/record-transfer` | 09 Refunds | `RecordRefundTransferRequest` (`refundTransactionReference`, `refundBankAccount`, `refundDate`, `verifiedAmount`) | Marks refund `COMPLETED` only when bank transfer reference, account, date, and exact amount match |
| `GET` | `/api/admin/reports` | 10 Reports | `dateFrom`, `dateTo`, `productType`, `paymentStatus`, `orderStatus` | `AdminReportResponse` |
| `GET` | `/api/admin/notifications` | 11 Notifications | `search`, `eventType`, `status`, `page` | `AdminNotificationsResponse` |
| `POST` | `/api/admin/notifications/{id}/retry` | 11 Notifications | Path `id` | `AdminNotificationLog` |
| `GET` | `/api/admin/settings` | 12 Settings | — | `AdminStoreSettings` |
| `PATCH` | `/api/admin/settings` | 12 Settings | `UpdateAdminSettingsRequest` | `AdminStoreSettings` |
