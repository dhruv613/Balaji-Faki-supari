import { Routes, Route, Navigate } from 'react-router-dom';
import AdminLayout from './AdminLayout';

/* --- Admin pages --- */
import AdminDashboardPage from '../features/admin/pages/AdminDashboardPage';
import AdminOrdersPage from '../features/admin/pages/AdminOrdersPage';
import AdminPaymentsPage from '../features/admin/pages/AdminPaymentsPage';
import AdminProductsPage from '../features/admin/pages/AdminProductsPage';
import AdminInventoryPage from '../features/admin/pages/AdminInventoryPage';
import AdminDeliveryPage from '../features/admin/pages/AdminDeliveryPage';
import AdminCustomersPage from '../features/admin/pages/AdminCustomersPage';
import AdminReviewsPage from '../features/admin/pages/AdminReviewsPage';
import AdminRefundsPage from '../features/admin/pages/AdminRefundsPage';
import AdminSettingsPage from '../features/admin/pages/AdminSettingsPage';

/** The Admin Panel app: every page sits under /admin, every other path lands on the dashboard. */
export default function App() {
  return (
    <Routes>
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
        <Route path="settings" element={<AdminSettingsPage />} />
        {/* Reports and Notifications are hidden until built; their page files and database history are kept. */}
        <Route path="reports" element={<Navigate to="/admin/dashboard" replace />} />
        <Route path="notifications" element={<Navigate to="/admin/dashboard" replace />} />
      </Route>
      <Route path="*" element={<Navigate to="/admin/dashboard" replace />} />
    </Routes>
  );
}
