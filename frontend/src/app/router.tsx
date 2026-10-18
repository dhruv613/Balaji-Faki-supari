import { Routes, Route, Navigate, useParams } from 'react-router-dom';

/* --- Layouts --- */
import StoreLayout from '../components/layout/StoreLayout';
import AdminLayout from '../components/layout/AdminLayout';

/* --- Customer pages --- */
import HomePage from '../features/catalog/pages/HomePage';
import OrderFormPage from '../features/orders/pages/OrderFormPage';
import ReviewOrderPage from '../features/orders/pages/ReviewOrderPage';
import PaymentFlowPage from '../features/payments/pages/PaymentFlowPage';
import QRPaymentPage from '../features/payments/pages/QRPaymentPage';
import PaymentVerificationPage from '../features/payments/pages/PaymentVerificationPage';
import OrderConfirmationPage from '../features/orders/pages/OrderConfirmationPage';
import MyOrdersPage from '../features/orders/pages/MyOrdersPage';
import OrderDetailsPage from '../features/orders/pages/OrderDetailsPage';
import CustomerReviewsPage from '../features/reviews/pages/CustomerReviewsPage';
import VisitStorePage from '../features/store/pages/VisitStorePage';
import HelpFAQsPage from '../features/help/pages/HelpFAQsPage';
import NotFoundPage from '../features/catalog/pages/NotFoundPage';

function LegacyTrackRedirect() {
  const { orderId } = useParams();
  return <Navigate to={orderId ? `/my-orders/${encodeURIComponent(orderId)}` : '/my-orders'} replace />;
}

/* --- Admin pages (12 modules) --- */
import AdminDashboardPage from '../features/admin/pages/AdminDashboardPage';
import AdminOrdersPage from '../features/admin/pages/AdminOrdersPage';
import AdminPaymentsPage from '../features/admin/pages/AdminPaymentsPage';
import AdminProductsPage from '../features/admin/pages/AdminProductsPage';
import AdminInventoryPage from '../features/admin/pages/AdminInventoryPage';
import AdminDeliveryPage from '../features/admin/pages/AdminDeliveryPage';
import AdminCustomersPage from '../features/admin/pages/AdminCustomersPage';
import AdminReviewsPage from '../features/admin/pages/AdminReviewsPage';
import AdminRefundsPage from '../features/admin/pages/AdminRefundsPage';
import AdminReportsPage from '../features/admin/pages/AdminReportsPage';
import AdminNotificationsPage from '../features/admin/pages/AdminNotificationsPage';
import AdminSettingsPage from '../features/admin/pages/AdminSettingsPage';

export function AppRouter() {
  return (
    <Routes>
      {/* ========== Customer-facing routes ========== */}
      <Route element={<StoreLayout />}>
        <Route index element={<HomePage />} />

        {/* Order flow */}
        <Route path="order" element={<OrderFormPage />} />
        <Route path="order/review" element={<ReviewOrderPage />} />
        <Route path="order/payment" element={<QRPaymentPage />} />
        <Route path="order/verification" element={<PaymentVerificationPage />} />
        <Route path="order/confirmation" element={<OrderConfirmationPage />} />

        {/* My Orders is the customer-facing order-status surface. */}
        <Route path="my-orders" element={<MyOrdersPage />} />
        <Route path="my-orders/:orderId" element={<OrderDetailsPage />} />
        <Route path="track" element={<Navigate to="/my-orders" replace />} />
        <Route path="track/:orderId" element={<LegacyTrackRedirect />} />

        {/* Other pages */}
        <Route path="reviews" element={<CustomerReviewsPage />} />
        <Route path="store" element={<VisitStorePage />} />
        <Route path="help" element={<HelpFAQsPage />} />
        <Route path="payment-flow" element={<PaymentFlowPage />} />
      </Route>

      {/* ========== Admin routes (primary 4 pages + preserved modules) ========== */}
      <Route path="admin" element={<AdminLayout />}>
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<AdminDashboardPage />} />
        <Route path="prices" element={<AdminProductsPage />} />
        <Route path="orders" element={<AdminOrdersPage />} />
        <Route path="feedback" element={<AdminReviewsPage />} />
        {/* Preserved additional admin routes */}
        <Route path="payments" element={<AdminPaymentsPage />} />
        <Route path="products" element={<AdminProductsPage />} />
        <Route path="inventory" element={<AdminInventoryPage />} />
        <Route path="delivery" element={<AdminDeliveryPage />} />
        <Route path="customers" element={<AdminCustomersPage />} />
        <Route path="reviews" element={<AdminReviewsPage />} />
        <Route path="refunds" element={<AdminRefundsPage />} />
        <Route path="reports" element={<AdminReportsPage />} />
        <Route path="notifications" element={<AdminNotificationsPage />} />
        <Route path="settings" element={<AdminSettingsPage />} />
      </Route>

      {/* ========== 404 fallback ========== */}
      <Route element={<StoreLayout />}>
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
