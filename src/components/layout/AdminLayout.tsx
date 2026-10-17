import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import {
  AdminSidebar,
  AdminHeader,
  AdminRouteGuard,
  AdminToastProvider,
} from '../../features/admin/components';
import '../../features/admin/styles/admin.css';

/**
 * AdminLayout — wraps all 12 admin modules with Owner Admin route protection,
 * responsive left navigation sidebar, top header bar, and toast notifications.
 */
export default function AdminLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
    setSidebarOpen(false);
  }, [pathname]);

  return (
    <AdminRouteGuard>
      <AdminToastProvider>
        <a href="#admin-main-content" className="skip-link">
          Skip to admin content
        </a>
        <div className="admin-shell">
          <AdminSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
          <div className="admin-main-column">
            <AdminHeader onOpenSidebar={() => setSidebarOpen(true)} />
            <main className="admin-workspace" id="admin-main-content" tabIndex={-1}>
              <Outlet />
            </main>
          </div>
        </div>
      </AdminToastProvider>
    </AdminRouteGuard>
  );
}
