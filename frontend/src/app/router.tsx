import { Routes, Route, Navigate, useParams } from 'react-router-dom';

/* --- Layouts --- */
import StoreLayout from '../components/layout/StoreLayout';

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
import ProductDetailsPage from '../features/catalog/pages/ProductDetailsPage';
import LoginPage from '../features/account/pages/LoginPage';
import AccountPage from '../features/account/pages/AccountPage';

function LegacyTrackRedirect() {
  const { orderId } = useParams();
  return <Navigate to={orderId ? `/my-orders/${encodeURIComponent(orderId)}` : '/my-orders'} replace />;
}

/** Customer storefront only. The Admin Panel is a separate app in `admin-panel/frontend` (its own Vercel project). */
export function AppRouter() {
  return (
    <Routes>
      <Route element={<StoreLayout />}>
        <Route index element={<HomePage />} />

        <Route path="products/:slug" element={<ProductDetailsPage />} />

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

        {/* Account */}
        <Route path="login" element={<LoginPage />} />
        <Route path="account" element={<AccountPage />} />

        {/* Other pages */}
        <Route path="reviews" element={<CustomerReviewsPage />} />
        <Route path="store" element={<VisitStorePage />} />
        <Route path="help" element={<HelpFAQsPage />} />
        <Route path="payment-flow" element={<PaymentFlowPage />} />

        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
