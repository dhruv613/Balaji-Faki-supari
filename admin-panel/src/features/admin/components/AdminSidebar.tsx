import { Link, NavLink } from 'react-router-dom';
import StoreLink from './StoreLink';
import { useSession, signOutFromButton } from '../../../lib/auth';

export interface AdminNavItem {
  to: string;
  label: string;
  badge?: string | number;
}

export interface AdminNavGroup {
  section: string;
  items: AdminNavItem[];
  /** Smaller secondary group shown under the primary links. */
  compact?: boolean;
}

export const ADMIN_NAV_GROUPS: AdminNavGroup[] = [
  {
    section: 'Admin Navigation',
    items: [
      { to: '/admin/dashboard', label: 'Dashboard' },
      { to: '/admin/prices', label: 'Price Management' },
      { to: '/admin/orders', label: 'Order Management' },
      { to: '/admin/feedback', label: 'Feedback Management' },
      { to: '/admin/settings', label: 'Settings' },
    ],
  },
];

/** Existing working pages that are not primary links. Shown as a separate group; the five primary links above stay as they are. */
export const ADMIN_OPERATIONS_GROUP: AdminNavGroup = {
  section: 'Operations',
  compact: true,
  items: [
    { to: '/admin/payments', label: 'Payments' },
    { to: '/admin/inventory', label: 'Inventory' },
    { to: '/admin/delivery', label: 'Delivery' },
    { to: '/admin/customers', label: 'Customers' },
    { to: '/admin/refunds', label: 'Refunds' },
  ],
};

const SIDEBAR_GROUPS: AdminNavGroup[] = [...ADMIN_NAV_GROUPS, ADMIN_OPERATIONS_GROUP];
const groupId = (section: string) => `admin-nav-${section.toLowerCase().replace(/\s+/g, '-')}`;

export interface AdminSidebarProps {
  open: boolean;
  onClose: () => void;
}

export default function AdminSidebar({ open, onClose }: AdminSidebarProps) {
  const { session } = useSession();
  const email = session?.user?.email ?? 'Not signed in';
  const fullName =
    (session?.user?.fullName as string | undefined)?.trim() ||
    email.split('@')[0] ||
    'Owner Admin';
  const phone = (session?.user?.phone as string | undefined)?.trim() || '';

  return (
    <>
      <div
        className={`admin-sidebar-backdrop ${open ? 'admin-sidebar-backdrop--open' : ''}`}
        aria-hidden="true"
        onClick={onClose}
      />
      <aside
        className={`admin-sidebar ${open ? 'admin-sidebar--open' : ''}`}
        aria-label="Admin module navigation"
      >
        <div className="admin-sidebar__brand">
          <Link to="/admin/dashboard" className="admin-sidebar__logo-link" onClick={onClose}>
            <img src="/images/balaji-logo.png" width="96" height="48" alt="Balaji Faki Point" />
            <span className="admin-badge">Admin</span>
          </Link>
          <button
            type="button"
            className="admin-sidebar__close"
            aria-label="Close navigation menu"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <nav className="admin-sidebar__nav">
          {SIDEBAR_GROUPS.map((group) => (
            <div
              key={group.section}
              role="group"
              aria-labelledby={groupId(group.section)}
              className={`admin-sidebar__group${group.compact ? ' admin-sidebar__group--compact' : ''}`}
            >
              <div
                id={groupId(group.section)}
                className="admin-sidebar__section-label"
              >
                {group.section}
              </div>
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={onClose}
                  className={({ isActive }) =>
                    `admin-sidebar__link${isActive ? ' admin-sidebar__link--active' : ''}`
                  }
                >
                  <span>{item.label}</span>
                  {item.badge !== undefined && (
                    <span className="admin-sidebar__link-badge">{item.badge}</span>
                  )}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="admin-sidebar__footer">
          <div className="admin-sidebar__user-card">
            <div className="admin-sidebar__user-name">{fullName}</div>
            <div className="admin-sidebar__user-meta">{email}</div>
            {phone && <div className="admin-sidebar__user-meta">{phone}</div>}
          </div>

          <StoreLink className="btn btn--outline btn--sm" style={{ width: '100%' }}>
            ← Customer Store
          </StoreLink>

          {session && (
            <button
              type="button"
              className="btn btn--dark btn--sm"
              style={{ width: '100%' }}
              onClick={() => {
                onClose();
                signOutFromButton();
              }}
            >
              Log out
            </button>
          )}
        </div>
      </aside>
    </>
  );
}
