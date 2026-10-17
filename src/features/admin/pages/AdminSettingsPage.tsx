import { useEffect, useState, type FormEvent } from 'react';
import Notice from '../../../components/common/Notice';
import { env } from '../../../lib/env';
import { supabase, useSession } from '../../../lib/supabase';
import { getErrorMessage } from '../../../lib/api';
import { getAdminSettings, updateAdminSettings } from '../api';
import type { AdminStoreSettings } from '../types';
import { SAMPLE_ADMIN_SETTINGS } from '../lib/referenceData';
import { ConfirmDialog, LoadingSkeleton, useAdminToast } from '../components';

export default function AdminSettingsPage() {
  const { session } = useSession();
  const { showToast } = useAdminToast();

  const [settings, setSettings] = useState<AdminStoreSettings>(SAMPLE_ADMIN_SETTINGS);
  const [pinCodesInput, setPinCodesInput] = useState(
    SAMPLE_ADMIN_SETTINGS.serviceablePinCodes.join(', '),
  );
  const [deliveryChargesInput, setDeliveryChargesInput] = useState('');

  // Sensitive payment destination confirmation state
  const [confirmSensitiveOpen, setConfirmSensitiveOpen] = useState(false);
  const [adminPasswordConfirm, setAdminPasswordConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  // Admin password change state
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState('');
  const [passwordError, setPasswordError] = useState('');

  const [loading, setLoading] = useState(Boolean(env.apiBaseUrl));
  const [error, setError] = useState('');
  const [isLive, setIsLive] = useState(false);

  useEffect(() => {
    let active = true;
    if (!env.apiBaseUrl) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    getAdminSettings()
      .then((res) => {
        if (active) {
          setSettings(res);
          setPinCodesInput(res.serviceablePinCodes.join(', '));
          setDeliveryChargesInput(
            res.deliveryCharges !== null ? String(res.deliveryCharges) : '',
          );
          setIsLive(true);
        }
      })
      .catch((err) => {
        if (active) setError(getErrorMessage(err));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function handleSaveGeneralSettings(e: FormEvent) {
    e.preventDefault();
    if (!env.apiBaseUrl) {
      showToast(
        'Integration pending: FastAPI (PATCH /api/admin/settings) is not connected. Store configuration updates require backend persistence.',
        'warning',
      );
      return;
    }

    const parsedPins = pinCodesInput
      .split(',')
      .map((s) => s.trim())
      .filter((s) => /^[1-9]\d{5}$/.test(s));

    setBusy(true);
    try {
      const updated = await updateAdminSettings({
        storeName: settings.storeName,
        storeAddress: settings.storeAddress,
        phoneNumber: settings.phoneNumber,
        supportEmail: settings.supportEmail,
        businessHours: settings.businessHours,
        deliveryCharges:
          deliveryChargesInput.trim() === '' ? null : Number(deliveryChargesInput),
        serviceablePinCodes: parsedPins,
        lowStockThreshold: settings.lowStockThreshold,
        orderCancellationPolicy: settings.orderCancellationPolicy,
        refundPolicy: settings.refundPolicy,
        emailNotificationPreferences: settings.emailNotificationPreferences,
      });
      setSettings(updated);
      showToast('Store settings updated and logged.', 'success');
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveSensitivePaymentDestination() {
    if (adminPasswordConfirm.trim().length < 6) {
      showToast(
        'Enter your current Owner Admin password to authorize changing the official UPI payment destination.',
        'warning',
      );
      return;
    }

    if (!env.apiBaseUrl) {
      showToast(
        'Integration pending: FastAPI (/api/admin/settings) is not connected. Payment destination changes require server authorization and audit logging.',
        'warning',
      );
      setConfirmSensitiveOpen(false);
      setAdminPasswordConfirm('');
      return;
    }

    setBusy(true);
    try {
      const updated = await updateAdminSettings({
        officialUpiId: settings.officialUpiId.trim(),
        officialPayeeName: settings.officialPayeeName.trim(),
        officialUpiQrImageUrl: settings.officialUpiQrImageUrl.trim(),
        adminCurrentPasswordForSensitiveChange: adminPasswordConfirm,
      });
      setSettings(updated);
      showToast('Official UPI destination updated and recorded in Admin Audit Log.', 'success');
      setConfirmSensitiveOpen(false);
      setAdminPasswordConfirm('');
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function handleChangeAdminPassword(e: FormEvent) {
    e.preventDefault();
    setPasswordError('');
    setPasswordMessage('');

    if (newPassword.length < 8) {
      setPasswordError('New password must be at least 8 characters long.');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setPasswordError('New password and confirmation do not match.');
      return;
    }
    if (!supabase) {
      setPasswordError('Supabase Auth is not configured in the current environment.');
      return;
    }

    setPasswordBusy(true);
    try {
      const { error: updateErr } = await supabase.auth.updateUser({
        password: newPassword,
      });
      if (updateErr) throw updateErr;
      setNewPassword('');
      setConfirmNewPassword('');
      setPasswordMessage('Owner Admin password updated through Supabase Auth.');
      showToast('Password updated.', 'success');
    } catch (err) {
      setPasswordError(getErrorMessage(err));
    } finally {
      setPasswordBusy(false);
    }
  }

  return (
    <div className="wrapper">
      <div className="admin-heading">
        <div>
          <h1 className="page__header">Store &amp; Security Settings</h1>
          <p className="page__subtitle">
            Manage store profile, official UPI payment destination, serviceable PIN codes, policies, and Owner Admin account security.
          </p>
        </div>
        <span className="badge badge--dark">No Secret Keys Exposed</span>
      </div>

      {!isLive && (
        <Notice title="Development reference configuration">
          FastAPI (<code>/api/admin/settings</code>) is not connected yet. Secret keys (Supabase service-role key, database credentials, SMTP secrets) are strictly server-only and never exposed to the browser.
        </Notice>
      )}
      {error && <Notice tone="error" title="Settings load error">{error}</Notice>}

      {loading ? (
        <LoadingSkeleton rows={6} />
      ) : (
        <div className="admin-two-col">
          {/* General Store Profile & Delivery Settings */}
          <form className="card" onSubmit={handleSaveGeneralSettings}>
            <h2 className="admin-section-title">1. Store Profile &amp; Delivery Rules</h2>

            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
              <img
                src={settings.logoUrl}
                alt="Balaji Faki Point Logo"
                style={{
                  height: 52,
                  width: 'auto',
                  padding: 6,
                  border: '1px solid var(--color-border)',
                  borderRadius: 10,
                }}
              />
              <div>
                <strong>Official Brand Logo</strong>
                <p className="text-small text-secondary">{settings.logoUrl}</p>
              </div>
            </div>

            <div className="form-row">
              <div>
                <label htmlFor="set-store-name">Store Name</label>
                <input
                  id="set-store-name"
                  className="input"
                  value={settings.storeName}
                  onChange={(e) => setSettings({ ...settings, storeName: e.target.value })}
                  required
                />
              </div>
              <div>
                <label htmlFor="set-phone">Official Phone / WhatsApp</label>
                <input
                  id="set-phone"
                  className="input"
                  value={settings.phoneNumber}
                  onChange={(e) => setSettings({ ...settings, phoneNumber: e.target.value })}
                  required
                />
              </div>
            </div>

            <div className="form-row">
              <div>
                <label htmlFor="set-email">Support Email</label>
                <input
                  id="set-email"
                  type="email"
                  className="input"
                  value={settings.supportEmail}
                  onChange={(e) => setSettings({ ...settings, supportEmail: e.target.value })}
                  required
                />
              </div>
              <div>
                <label htmlFor="set-hours">Business Hours</label>
                <input
                  id="set-hours"
                  className="input"
                  value={settings.businessHours}
                  onChange={(e) => setSettings({ ...settings, businessHours: e.target.value })}
                />
              </div>
            </div>

            <div style={{ marginBottom: 14 }}>
              <label htmlFor="set-address">Store Address</label>
              <textarea
                id="set-address"
                className="input"
                value={settings.storeAddress}
                onChange={(e) => setSettings({ ...settings, storeAddress: e.target.value })}
                required
              />
            </div>

            <div className="form-row">
              <div>
                <label htmlFor="set-del-fee">Delivery Charges (₹ INR)</label>
                <input
                  id="set-del-fee"
                  type="number"
                  min="0"
                  step="0.01"
                  className="input"
                  placeholder="Awaiting server fee"
                  value={deliveryChargesInput}
                  onChange={(e) => setDeliveryChargesInput(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="set-low-stock">Low Stock Alert Threshold (Packs)</label>
                <input
                  id="set-low-stock"
                  type="number"
                  min="1"
                  step="1"
                  className="input"
                  value={settings.lowStockThreshold}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      lowStockThreshold: Math.max(1, Number(e.target.value) || 1),
                    })
                  }
                />
              </div>
            </div>

            <div style={{ marginBottom: 14 }}>
              <label htmlFor="set-pins">Serviceable 6-Digit PIN Codes (Comma-separated)</label>
              <input
                id="set-pins"
                className="input"
                value={pinCodesInput}
                onChange={(e) => setPinCodesInput(e.target.value)}
              />
            </div>

            <div style={{ marginBottom: 14 }}>
              <label htmlFor="set-cancel-policy">Order Cancellation Policy</label>
              <textarea
                id="set-cancel-policy"
                className="input"
                value={settings.orderCancellationPolicy}
                onChange={(e) =>
                  setSettings({ ...settings, orderCancellationPolicy: e.target.value })
                }
              />
            </div>

            <div style={{ marginBottom: 14 }}>
              <label htmlFor="set-refund-policy">Refund Policy</label>
              <textarea
                id="set-refund-policy"
                className="input"
                value={settings.refundPolicy}
                onChange={(e) => setSettings({ ...settings, refundPolicy: e.target.value })}
              />
            </div>

            <fieldset>
              <legend style={{ fontSize: 16 }}>Email Notification Preferences</legend>
              <div className="checkbox-row">
                <input
                  id="pref-cust-order"
                  type="checkbox"
                  checked={settings.emailNotificationPreferences.sendCustomerOrderUpdates}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      emailNotificationPreferences: {
                        ...settings.emailNotificationPreferences,
                        sendCustomerOrderUpdates: e.target.checked,
                      },
                    })
                  }
                />
                <label htmlFor="pref-cust-order" style={{ marginBottom: 0, fontWeight: 400 }}>
                  Send customer order &amp; delivery status emails
                </label>
              </div>
              <div className="checkbox-row">
                <input
                  id="pref-cust-pay"
                  type="checkbox"
                  checked={settings.emailNotificationPreferences.sendCustomerPaymentReceipts}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      emailNotificationPreferences: {
                        ...settings.emailNotificationPreferences,
                        sendCustomerPaymentReceipts: e.target.checked,
                      },
                    })
                  }
                />
                <label htmlFor="pref-cust-pay" style={{ marginBottom: 0, fontWeight: 400 }}>
                  Send customer payment verification &amp; refund updates
                </label>
              </div>
              <div className="checkbox-row">
                <input
                  id="pref-admin-stock"
                  type="checkbox"
                  checked={settings.emailNotificationPreferences.sendAdminLowStockAlerts}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      emailNotificationPreferences: {
                        ...settings.emailNotificationPreferences,
                        sendAdminLowStockAlerts: e.target.checked,
                      },
                    })
                  }
                />
                <label htmlFor="pref-admin-stock" style={{ marginBottom: 0, fontWeight: 400 }}>
                  Send Owner Admin low-stock alerts
                </label>
              </div>
            </fieldset>

            <button type="submit" className="btn btn--primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save Store & Policy Settings'}
            </button>
          </form>

          {/* Right Column: Official UPI Destination + Admin Account & Password */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            <section className="card card--tinted" aria-labelledby="upi-dest-heading">
              <div className="detail-header">
                <h2 id="upi-dest-heading" className="admin-section-title" style={{ marginBottom: 0 }}>
                  2. Official UPI Payment Destination
                </h2>
                <span className="badge badge--warning">Audit Logged</span>
              </div>
              <p className="text-small text-secondary" style={{ marginBottom: 14 }}>
                Sensitive financial setting. Modifying the official merchant UPI ID or QR image requires Owner Admin password re-verification and creates a high-priority audit log entry.
              </p>

              <div style={{ marginBottom: 12 }}>
                <label htmlFor="set-payee-name">Official Merchant Payee Name</label>
                <input
                  id="set-payee-name"
                  className="input"
                  value={settings.officialPayeeName}
                  onChange={(e) =>
                    setSettings({ ...settings, officialPayeeName: e.target.value })
                  }
                />
              </div>

              <div style={{ marginBottom: 12 }}>
                <label htmlFor="set-upi-id">Official UPI ID</label>
                <input
                  id="set-upi-id"
                  className="input"
                  value={settings.officialUpiId}
                  onChange={(e) => setSettings({ ...settings, officialUpiId: e.target.value })}
                />
              </div>

              <div style={{ marginBottom: 16 }}>
                <label htmlFor="set-qr-url">Official UPI QR Image Storage Path</label>
                <input
                  id="set-qr-url"
                  className="input"
                  placeholder="Issued by FastAPI from verified merchant storage"
                  value={settings.officialUpiQrImageUrl}
                  onChange={(e) =>
                    setSettings({ ...settings, officialUpiQrImageUrl: e.target.value })
                  }
                />
              </div>

              <button
                type="button"
                className="btn btn--dark"
                onClick={() => setConfirmSensitiveOpen(true)}
              >
                Authorize &amp; Update UPI Destination
              </button>
            </section>

            {/* Admin Account Information & Change Password */}
            <section className="card" aria-labelledby="admin-acc-heading">
              <h2 id="admin-acc-heading" className="admin-section-title">
                3. Owner Admin Account &amp; Password
              </h2>
              <dl className="admin-kv-grid">
                <div className="admin-kv-item">
                  <dt>Signed-In Email</dt>
                  <dd>{session?.user?.email ?? settings.adminAccount.email}</dd>
                </div>
                <div className="admin-kv-item">
                  <dt>Provisioned Role</dt>
                  <dd><span className="badge badge--dark">OWNER_ADMIN</span></dd>
                </div>
              </dl>

              <form onSubmit={handleChangeAdminPassword}>
                <h3 style={{ fontSize: 18, marginBottom: 10 }}>Change Owner Admin Password</h3>
                {passwordError && <Notice tone="error">{passwordError}</Notice>}
                {passwordMessage && <Notice tone="success">{passwordMessage}</Notice>}

                <div className="form-row">
                  <div>
                    <label htmlFor="admin-new-pass">New Password</label>
                    <input
                      id="admin-new-pass"
                      type="password"
                      autoComplete="new-password"
                      className="input"
                      placeholder="At least 8 characters"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <label htmlFor="admin-confirm-pass">Confirm New Password</label>
                    <input
                      id="admin-confirm-pass"
                      type="password"
                      autoComplete="new-password"
                      className="input"
                      placeholder="Repeat new password"
                      value={confirmNewPassword}
                      onChange={(e) => setConfirmNewPassword(e.target.value)}
                      required
                    />
                  </div>
                </div>

                <button type="submit" className="btn btn--outline" disabled={passwordBusy}>
                  {passwordBusy ? 'Updating Password…' : 'Update Password'}
                </button>
              </form>
            </section>
          </div>
        </div>
      )}

      {/* Confirmation Dialog for Sensitive UPI Destination Change */}
      <ConfirmDialog
        open={confirmSensitiveOpen}
        title="Confirm Sensitive UPI Destination Change"
        description="Changing the official merchant UPI ID or QR image affects where customer payments are directed. Re-enter your Owner Admin password to authorize and audit-log this change."
        confirmLabel="Verify & Save UPI Settings"
        tone="danger"
        busy={busy}
        onConfirm={handleSaveSensitivePaymentDestination}
        onCancel={() => {
          setConfirmSensitiveOpen(false);
          setAdminPasswordConfirm('');
        }}
      >
        <div style={{ marginTop: 12 }}>
          <label htmlFor="sensitive-auth-password">Current Owner Admin Password</label>
          <input
            id="sensitive-auth-password"
            type="password"
            autoComplete="current-password"
            className="input"
            placeholder="Enter password to authorize…"
            value={adminPasswordConfirm}
            onChange={(e) => setAdminPasswordConfirm(e.target.value)}
          />
        </div>
      </ConfirmDialog>
    </div>
  );
}
