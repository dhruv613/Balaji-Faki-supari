# Balaji Faki Point — UI Design Reference Index

All original static HTML, PDF, and 2x PNG UI design exports have been moved out of `frontend/` into this directory (`docs/design-reference/`) so `frontend/` exclusively houses the React + TypeScript + Vite application.

## Preserved Design Assets in `docs/design-reference/`

- `docs/design-reference/Balaji Faki Point – Website UI (1).html` (Master static HTML design file)
- `docs/design-reference/Balaji Faki Point – Website UI (1).pdf` (Master PDF design export)
- `docs/design-reference/Balaji Faki Point – Website UI-png (1)/` (13 high-resolution 2x PNG screen exports)
- `docs/design-reference/Balaji-Faki-Point-Website-UI/` (13 individual screen HTML reference files)

## Route-to-Reference Mapping

| Screen # | Reference HTML (`Balaji-Faki-Point-Website-UI/`) | Reference PNG (`Balaji Faki Point – Website UI-png (1)/`) | React Route | React Component (`frontend/src/features/`) |
|---|---|---|---|---|
| 01 | `01-Home.html` | `Home.png` | `/` | `catalog/pages/HomePage.tsx` |
| 02 | `02-Order-Form.html` | `Order Form.png` | `/order` | `orders/pages/OrderFormPage.tsx` |
| 03 | `03-Review-Order.html` | `Review Order.png` | `/review-order` | `orders/pages/ReviewOrderPage.tsx` |
| 04 | `04-QR-Payment.html` | `QR Payment.png` | `/payment/qr` | `payments/pages/QRPaymentPage.tsx` |
| 05 | `05-Payment-Verification.html` | `Payment Verification.png` | `/payment/verification` | `payments/pages/PaymentVerificationPage.tsx` |
| 06 | `06-Order-Confirmation.html` | `Order Confirmation.png` | `/order-confirmation` | `orders/pages/OrderConfirmationPage.tsx` |
| 07 | `07-My-Orders.html` | `My Orders.png` | `/my-orders` | `orders/pages/MyOrdersPage.tsx` |
| 08 | `08-Order-Tracking.html` | `Order Tracking.png` | `/track` | `orders/pages/OrderTrackingPage.tsx` |
| 09 | `09-Visit-Store.html` | `Visit Store.png` | `/visit-store` | `store/pages/VisitStorePage.tsx` |
| 10 | `10-Help-FAQs.html` | `Help & FAQs.png` | `/help` | `help/pages/HelpFAQsPage.tsx` |
| 11 | `11-Payment-Flow.html` | `Payment Flow.png` | `/payment-flow` | `payments/pages/PaymentFlowPage.tsx` |
| 12 | `12-Customer-Reviews.html` | `Customer Reviews.png` | `/reviews` | `reviews/pages/CustomerReviewsPage.tsx` |
| 13 | `13-All-Customers-Admin.html` | `All Customers (Admin).png` | `/admin/customers` | `admin/pages/AdminCustomersPage.tsx` |
