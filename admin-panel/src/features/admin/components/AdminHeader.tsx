import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import StoreLink from './StoreLink';
import { authClient, signOut, useSession } from '../../../lib/auth';
import { updateProfile } from '../../../lib/profile';
import { normalizeIndianMobile, validateCustomerDetails } from '../../../lib/customer';

export interface AdminHeaderProps {
  onOpenSidebar: () => void;
}

export default function AdminHeader({ onOpenSidebar }: AdminHeaderProps) {
  const { session, profile } = useSession();
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [signingOut, setSigningOut] = useState(false);

  // Profile modal / dropdown state
  const [profileOpen, setProfileOpen] = useState(false);
  const [fullName, setFullName] = useState(
    () => (session?.user?.fullName as string | undefined) ?? '',
  );
  const [phone, setPhone] = useState(() =>
    normalizeIndianMobile((session?.user?.phone as string | undefined) ?? ''),
  );
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState('');
  const [profileErr, setProfileErr] = useState('');

  const userEmail = session?.user?.email ?? 'Not signed in';
  const displayName =
    (session?.user?.fullName as string | undefined)?.trim() ||
    userEmail.split('@')[0] ||
    'Admin';
  const userRole = profile?.role ?? 'Checking role';
  const userPhone =
    (session?.user?.phone as string | undefined)?.trim() || 'Not set';
  const initials = displayName.slice(0, 2).toUpperCase();

  function openProfileModal() {
    setFullName((session?.user?.fullName as string | undefined) ?? '');
    setPhone(
      normalizeIndianMobile((session?.user?.phone as string | undefined) ?? ''),
    );
    setProfileMsg('');
    setProfileErr('');
    setProfileOpen(true);
  }

  function handleSearch(e: FormEvent) {
    e.preventDefault();
    const trimmed = searchQuery.trim();
    if (!trimmed) return;
    navigate(`/admin/orders?q=${encodeURIComponent(trimmed)}`);
  }

  async function handleSaveProfile(e: FormEvent) {
    e.preventDefault();
    setProfileMsg('');
    setProfileErr('');

    const validation = validateCustomerDetails({ fullName, phone });
    if (validation.fullName || validation.phone) {
      setProfileErr(validation.fullName || validation.phone || 'Please check your details.');
      return;
    }
    if (!authClient || savingProfile) return;

    setSavingProfile(true);
    try {
      await updateProfile({
          fullName: fullName.trim(),
          phone: `+91${normalizeIndianMobile(phone)}`,
      });
      setProfileMsg('Profile saved to database ✅');
    } catch (err) {
      setProfileErr(err instanceof Error ? err.message : 'Unable to update profile.');
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleLogout() {
    if (!authClient || signingOut) return;
    setSigningOut(true);
    try {
      setProfileOpen(false);
      await signOut();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Unable to sign out. Please try again.');
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <>
      <header className="admin-topbar" id="admin-header">
        <div className="admin-topbar__left">
          <button
            type="button"
            className="admin-topbar__menu-btn"
            aria-label="Open navigation sidebar"
            onClick={onOpenSidebar}
          >
            ☰
          </button>

          <form className="admin-topbar__search" onSubmit={handleSearch} role="search">
            <svg
              className="icon icon--sm admin-topbar__search-icon"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3.5-3.5" />
            </svg>
            <input
              type="search"
              className="input"
              placeholder="Search Order #BFP-1042, customer, or phone…"
              aria-label="Global admin search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </form>
        </div>

        <div className="admin-topbar__right">
          <button
            type="button"
            className="admin-profile-pill"
            onClick={openProfileModal}
            title="View & edit your Admin profile"
          >
            <span className="admin-profile-pill__avatar" aria-hidden="true">
              {initials}
            </span>
            <span className="admin-profile-pill__meta">
              <span className="admin-profile-pill__name">
                {displayName}
              </span>
              <span className="admin-profile-pill__email">
                {userEmail}
              </span>
            </span>
          </button>

          <StoreLink className="btn btn--outline btn--sm">
            Store
          </StoreLink>

          <button
            type="button"
            className="btn btn--dark btn--sm"
            disabled={signingOut || !authClient}
            onClick={handleLogout}
          >
            {signingOut ? 'Signing out…' : 'Log out'}
          </button>
        </div>
      </header>

      {profileOpen && (
        <div
          className="admin-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="admin-profile-modal-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setProfileOpen(false);
          }}
        >
          <div className="admin-modal" style={{ maxWidth: 460 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h2 id="admin-profile-modal-title" style={{ margin: 0, fontSize: '1.35rem' }}>
                Admin Profile &amp; Account
              </h2>
              <button
                type="button"
                className="text-button"
                onClick={() => setProfileOpen(false)}
                aria-label="Close profile dialog"
              >
                ✕
              </button>
            </div>

            <div
              className="card card--tinted"
              style={{
                padding: 14,
                marginBottom: 16,
                display: 'flex',
                alignItems: 'center',
                gap: 12,
              }}
            >
              <span
                className="admin-profile-pill__avatar"
                style={{ width: 44, height: 44, fontSize: '1rem' }}
              >
                {initials}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: '1rem' }}>{displayName}</div>
                <div className="text-small text-secondary" style={{ wordBreak: 'break-all' }}>
                  {userEmail}
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4, flexWrap: 'wrap' }}>
                  <span className="badge badge--green">{userRole}</span>
                  <span className="text-small text-secondary">{userPhone}</span>
                </div>
              </div>
            </div>

            <form onSubmit={handleSaveProfile}>
              {profileErr && (
                <p className="field-error" style={{ marginBottom: 10 }}>
                  {profileErr}
                </p>
              )}
              {profileMsg && (
                <p
                  className="text-small"
                  style={{ color: 'var(--color-green)', fontWeight: 600, marginBottom: 10 }}
                >
                  {profileMsg}
                </p>
              )}

              <label htmlFor="admin-profile-name">Full Name</label>
              <input
                id="admin-profile-name"
                className="input"
                type="text"
                maxLength={100}
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                disabled={savingProfile}
              />

              <label htmlFor="admin-profile-phone">Mobile Number (+91)</label>
              <input
                id="admin-profile-phone"
                className="input"
                type="tel"
                inputMode="numeric"
                maxLength={10}
                placeholder="10-digit Indian mobile number"
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                required
                disabled={savingProfile}
              />

              <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
                <button
                  type="submit"
                  className="btn btn--primary"
                  style={{ flex: 1 }}
                  disabled={savingProfile}
                >
                  {savingProfile ? 'Saving…' : 'Save Profile'}
                </button>
                <Link
                  to="/admin/settings"
                  className="btn btn--outline"
                  onClick={() => setProfileOpen(false)}
                >
                  Settings
                </Link>
              </div>
            </form>

            <hr style={{ border: 0, borderTop: '1px solid var(--color-border)', margin: '16px 0' }} />

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <StoreLink className="text-button" onClick={() => setProfileOpen(false)}>
                ← Go to Customer Store
              </StoreLink>
              <button
                type="button"
                className="btn btn--dark btn--sm"
                onClick={handleLogout}
                disabled={signingOut}
              >
                {signingOut ? 'Signing out…' : 'Log out'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
