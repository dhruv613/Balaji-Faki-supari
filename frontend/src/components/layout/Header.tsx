import { Link, NavLink } from 'react-router-dom';
import { env } from '../../lib/env';
import { supabase, useSession } from '../../lib/supabase';

const NAV_ITEMS = [
  { to: '/', label: 'Home' },
  { to: '/order', label: 'Order' },
  { to: '/my-orders', label: 'My Orders' },
  { to: '/reviews', label: 'Reviews' },
  { to: '/store', label: 'Visit Store' },
  { to: '/help', label: 'Help' },
];

export default function Header() {
  const { session } = useSession();
  const isOwnerAdmin = session?.user?.app_metadata?.role === 'OWNER_ADMIN' && Boolean(env.adminUrl);
  const displayName =
    (session?.user?.user_metadata?.fullName as string | undefined)?.trim() ||
    session?.user?.email?.split('@')[0] ||
    'Account';

  return (
    <header className="header" id="site-header">
      <div className="wrapper">
        {/* Logo */}
        <Link to="/" className="header__logo" aria-label="Balaji Faki Point – Home">
          <img src="/images/balaji-logo.png" width="109" height="56" alt="Balaji Faki Point" />
        </Link>

        {/* Navigation */}
        <nav className="nav" aria-label="Main navigation">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `nav__link${isActive ? ' nav__link--active' : ''}`
              }
            >
              {item.label}
            </NavLink>
          ))}
          {isOwnerAdmin && (
            <a
              href={`${env.adminUrl.replace(/\/$/, '')}/admin/dashboard`}
              className="nav__link"
              style={{ color: 'var(--orange-dark)', fontWeight: 700 }}
            >
              Admin Panel
            </a>
          )}
        </nav>

        {/* Right actions */}
        <div className="header__actions">
          {session ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Link
                to="/account"
                className="text-small"
                style={{ fontWeight: 600, textDecoration: 'none', color: 'var(--text)' }}
                title={session.user.email}
              >
                👤 {displayName}
              </Link>
              {supabase && (
                <button
                  type="button"
                  className="text-button"
                  style={{ fontSize: '0.82rem' }}
                  onClick={() => supabase?.auth.signOut()}
                >
                  Log out
                </button>
              )}
            </div>
          ) : (
            <Link to="/login" className="text-small" style={{ fontWeight: 600, textDecoration: 'none', color: 'var(--text)' }}>
              Sign in
            </Link>
          )}
          <Link to="/order" className="btn btn--primary">
            Order Now
          </Link>
        </div>
      </div>
    </header>
  );
}
