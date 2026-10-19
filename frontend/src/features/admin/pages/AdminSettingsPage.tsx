import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import Notice from '../../../components/common/Notice';
import { env } from '../../../lib/env';
import { getErrorMessage, resolveApiUrl } from '../../../lib/api';
import {
  addStorePhoto,
  confirmBusinessSettings,
  deleteStorePhoto,
  getAdminSettings,
  updateAdminSettings,
  uploadPaymentQr,
} from '../api';
import type { AdminStoreSettings, UpdateAdminSettingsRequest } from '../types';
import { ErrorState, LoadingSkeleton, useAdminToast } from '../components';

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/** Parses "360001, 360002" into unique 6-digit PIN codes; returns null when an entry is invalid. */
export function parsePinCodes(input: string): string[] | null {
  const pins = input.split(/[\s,]+/).map((pin) => pin.trim()).filter(Boolean);
  if (pins.some((pin) => !/^[1-9]\d{5}$/.test(pin)) || new Set(pins).size !== pins.length) return null;
  return pins;
}

/** Builds a PATCH body containing only the fields that actually changed. */
export function changedSettings(current: AdminStoreSettings, form: SettingsForm): UpdateAdminSettingsRequest | { error: string } {
  const patch: UpdateAdminSettingsRequest = {};
  const text = (key: keyof SettingsForm & keyof UpdateAdminSettingsRequest) => {
    if (form[key] !== (current[key as keyof AdminStoreSettings] ?? '')) (patch as Record<string, unknown>)[key] = form[key];
  };
  (['storeName', 'tagline', 'storeAddress', 'phoneNumber', 'supportWhatsapp', 'supportEmail', 'businessHours', 'shopIntro',
    'productionInfo', 'providerManufacturer', 'packagingInfo', 'officialUpiId', 'officialPayeeName'] as const).forEach(text);
  const pins = parsePinCodes(form.serviceablePinCodes);
  if (pins === null) return { error: 'PIN codes must be unique 6-digit numbers separated by commas.' };
  if (pins.join(',') !== current.serviceablePinCodes.join(',')) patch.serviceablePinCodes = pins;
  for (const [key, label] of [['deliveryCharges', 'Delivery charge'], ['freeDeliveryThreshold', 'Free-delivery threshold']] as const) {
    const raw = form[key].trim();
    const value = raw === '' ? null : Number(raw);
    if (value !== null && (!Number.isFinite(value) || value < 0)) return { error: `${label} must be a number of rupees, 0 or more.` };
    if (value !== (current[key] ?? null)) patch[key] = value;
  }
  const threshold = Number(form.lowStockThreshold);
  if (!Number.isInteger(threshold) || threshold < 0) return { error: 'Low-stock threshold must be a whole number, 0 or more.' };
  if (threshold !== current.lowStockThreshold) patch.lowStockThreshold = threshold;
  return patch;
}

export interface SettingsForm {
  storeName: string; tagline: string; storeAddress: string; phoneNumber: string; supportWhatsapp: string;
  supportEmail: string; businessHours: string; shopIntro: string; productionInfo: string;
  providerManufacturer: string; packagingInfo: string; officialUpiId: string; officialPayeeName: string;
  deliveryCharges: string; freeDeliveryThreshold: string; serviceablePinCodes: string; lowStockThreshold: string;
}

export function toForm(settings: AdminStoreSettings): SettingsForm {
  return {
    storeName: settings.storeName, tagline: settings.tagline, storeAddress: settings.storeAddress,
    phoneNumber: settings.phoneNumber, supportWhatsapp: settings.supportWhatsapp, supportEmail: settings.supportEmail ?? '',
    businessHours: settings.businessHours, shopIntro: settings.shopIntro ?? '', productionInfo: settings.productionInfo ?? '',
    providerManufacturer: settings.providerManufacturer ?? '', packagingInfo: settings.packagingInfo ?? '',
    officialUpiId: settings.officialUpiId ?? '', officialPayeeName: settings.officialPayeeName ?? '',
    deliveryCharges: settings.deliveryCharges === null ? '' : String(settings.deliveryCharges),
    freeDeliveryThreshold: settings.freeDeliveryThreshold === null ? '' : String(settings.freeDeliveryThreshold),
    serviceablePinCodes: settings.serviceablePinCodes.join(', '),
    lowStockThreshold: String(settings.lowStockThreshold),
  };
}

/** Settings: shop details, payment destination, delivery rules. Nothing is shown or saved until the server answers. */
export default function AdminSettingsPage() {
  const { showToast } = useAdminToast();
  const [settings, setSettings] = useState<AdminStoreSettings | null>(null);
  const [form, setForm] = useState<SettingsForm | null>(null);
  const [loading, setLoading] = useState(Boolean(env.apiBaseUrl));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [photoCaption, setPhotoCaption] = useState('');

  const apply = useCallback((next: AdminStoreSettings) => { setSettings(next); setForm(toForm(next)); }, []);
  const load = useCallback(() => {
    if (!env.apiBaseUrl) return;
    setLoading(true); setError('');
    getAdminSettings().then(apply).catch((cause) => setError(getErrorMessage(cause))).finally(() => setLoading(false));
  }, [apply]);
  useEffect(load, [load]);

  async function run<T>(action: () => Promise<T>, success: string): Promise<T | undefined> {
    if (busy) return undefined;
    setBusy(true); setFormError('');
    try {
      const result = await action();
      showToast(success, 'success');
      return result;
    } catch (cause) {
      setFormError(getErrorMessage(cause));
      return undefined;
    } finally { setBusy(false); }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!settings || !form) return; // Save is only possible after a successful load: placeholders can never be saved.
    const patch = changedSettings(settings, form);
    if ('error' in patch) { setFormError(patch.error); return; }
    if (Object.keys(patch).length === 0) { setFormError('Nothing has changed.'); return; }
    const next = await run(() => updateAdminSettings(patch), 'Settings saved.');
    if (next) apply(next);
  }

  async function pickImage(event: ChangeEvent<HTMLInputElement>, handler: (file: File) => Promise<AdminStoreSettings>, success: string) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!IMAGE_TYPES.includes(file.type)) { setFormError('Choose a JPG, PNG or WEBP image.'); return; }
    const next = await run(() => handler(file), success);
    if (next) apply(next);
  }

  const set = (key: keyof SettingsForm) => (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((current) => (current ? { ...current, [key]: event.target.value } : current));

  return (
    <div className="wrapper">
      <div className="admin-heading">
        <div>
          <h1 className="page__header">Settings</h1>
          <p className="page__subtitle">Shop details, payment destination and delivery rules.</p>
        </div>
      </div>

      {!env.apiBaseUrl && <Notice tone="warning" title="Server not connected">Connect the local FastAPI server to view and change settings. No sample values are shown.</Notice>}
      {error && <ErrorState message={error} onRetry={load} />}
      {loading && !settings && <LoadingSkeleton rows={5} />}

      {settings && form && (
        <form onSubmit={save} noValidate>
          {formError && <Notice tone="error" title="Not saved">{formError}</Notice>}

          <section className="card" style={{ marginBottom: 24 }} aria-labelledby="settings-payment-heading">
            <h2 id="settings-payment-heading">Payment &amp; go-live confirmation</h2>
            {settings.paymentIsLocalTest && (
              <Notice tone="warning" title="LOCAL TEST payment details">
                The payment destination is a test value, not a real receiving account. Replace it before taking real orders.
              </Notice>
            )}
            {settings.businessSettingsConfirmedAt ? (
              <Notice title="Confirmed">You confirmed these payment, delivery and PIN settings on {new Date(settings.businessSettingsConfirmedAt).toLocaleString('en-IN')}.</Notice>
            ) : (
              <Notice tone="info" title="Not confirmed yet">
                Outside local testing, checkout stays closed until you confirm the payment destination, QR, delivery charge and PIN codes. Changing any of them withdraws the confirmation.
              </Notice>
            )}
            <label htmlFor="set-upi">UPI ID</label>
            <input id="set-upi" className="input" value={form.officialUpiId} onChange={set('officialUpiId')} disabled={busy} maxLength={120} autoComplete="off" />
            <label htmlFor="set-payee">Payee name</label>
            <input id="set-payee" className="input" value={form.officialPayeeName} onChange={set('officialPayeeName')} disabled={busy} maxLength={120} />
            <p className="text-small" style={{ marginTop: 12 }}><strong>Payment QR</strong></p>
            {settings.officialUpiQrImageUrl
              ? <img src={resolveApiUrl(settings.officialUpiQrImageUrl)} alt="Current payment QR" width={180} height={180} style={{ background: '#fff' }} />
              : <p className="text-secondary text-small">No QR uploaded yet.</p>}
            <label htmlFor="set-qr">Upload a new QR image</label>
            <input id="set-qr" className="input" type="file" accept="image/jpeg,image/png,image/webp" disabled={busy}
              onChange={(event) => void pickImage(event, uploadPaymentQr, 'Payment QR replaced. Confirm the settings again.')} />
            <button type="button" className="btn btn--primary" style={{ marginTop: 16 }} disabled={busy || Boolean(settings.businessSettingsConfirmedAt) || settings.paymentIsLocalTest}
              onClick={() => void run(() => confirmBusinessSettings(), 'Settings confirmed.').then((next) => next && apply(next))}>
              Confirm payment, delivery &amp; PIN settings
            </button>
            {settings.paymentIsLocalTest && <p className="text-small text-secondary">Replace the LOCAL TEST UPI ID first.</p>}
          </section>

          <section className="card" style={{ marginBottom: 24 }} aria-labelledby="settings-delivery-heading">
            <h2 id="settings-delivery-heading">Delivery &amp; stock</h2>
            <label htmlFor="set-delivery">Delivery charge (₹, 0 = free)</label>
            <input id="set-delivery" className="input" inputMode="decimal" value={form.deliveryCharges} onChange={set('deliveryCharges')} disabled={busy} />
            <label htmlFor="set-free">Free delivery above (₹, blank = none)</label>
            <input id="set-free" className="input" inputMode="decimal" value={form.freeDeliveryThreshold} onChange={set('freeDeliveryThreshold')} disabled={busy} />
            <label htmlFor="set-pins">Serviceable PIN codes</label>
            <textarea id="set-pins" className="input" value={form.serviceablePinCodes} onChange={set('serviceablePinCodes')} disabled={busy} />
            <label htmlFor="set-low">Low-stock alert at (units)</label>
            <input id="set-low" className="input" inputMode="numeric" value={form.lowStockThreshold} onChange={set('lowStockThreshold')} disabled={busy} />
            <p className="text-small text-secondary" style={{ marginTop: 8 }}>
              Stock held for unpaid orders: {settings.stockReservationExpiryMinutes} minutes. Orders are never cancelled automatically; the release policy is pending the owner&apos;s decision.
            </p>
          </section>

          <section className="card" style={{ marginBottom: 24 }} aria-labelledby="settings-shop-heading">
            <h2 id="settings-shop-heading">Shop details (shown to customers)</h2>
            <label htmlFor="set-name">Shop name</label>
            <input id="set-name" className="input" value={form.storeName} onChange={set('storeName')} disabled={busy} maxLength={120} />
            <label htmlFor="set-tagline">Tagline</label>
            <input id="set-tagline" className="input" value={form.tagline} onChange={set('tagline')} disabled={busy} maxLength={255} />
            <label htmlFor="set-address">Address</label>
            <textarea id="set-address" className="input" value={form.storeAddress} onChange={set('storeAddress')} disabled={busy} maxLength={255} />
            <label htmlFor="set-hours">Opening hours</label>
            <input id="set-hours" className="input" value={form.businessHours} onChange={set('businessHours')} disabled={busy} maxLength={120} />
            <label htmlFor="set-phone">Phone</label>
            <input id="set-phone" className="input" value={form.phoneNumber} onChange={set('phoneNumber')} disabled={busy} maxLength={32} />
            <label htmlFor="set-wa">WhatsApp number (digits with country code)</label>
            <input id="set-wa" className="input" value={form.supportWhatsapp} onChange={set('supportWhatsapp')} disabled={busy} maxLength={32} />
            <label htmlFor="set-email">Support e-mail (optional)</label>
            <input id="set-email" className="input" type="email" value={form.supportEmail} onChange={set('supportEmail')} disabled={busy} maxLength={255} />
            <label htmlFor="set-intro">Shop introduction (optional)</label>
            <textarea id="set-intro" className="input" value={form.shopIntro} onChange={set('shopIntro')} disabled={busy} maxLength={4000} />
            <label htmlFor="set-production">How products are prepared (optional)</label>
            <textarea id="set-production" className="input" value={form.productionInfo} onChange={set('productionInfo')} disabled={busy} maxLength={4000} />
            <label htmlFor="set-provider">Provider / manufacturer (optional)</label>
            <textarea id="set-provider" className="input" value={form.providerManufacturer} onChange={set('providerManufacturer')} disabled={busy} maxLength={4000} />
            <label htmlFor="set-packaging">Packaging (optional)</label>
            <textarea id="set-packaging" className="input" value={form.packagingInfo} onChange={set('packagingInfo')} disabled={busy} maxLength={4000} />
            <p className="text-small text-secondary" style={{ marginTop: 8 }}>Leave optional fields empty until you have confirmed facts to publish; empty fields are hidden from customers.</p>
          </section>

          <button type="submit" className="btn btn--primary" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>

          <section className="card" style={{ marginTop: 24 }} aria-labelledby="settings-photos-heading">
            <h2 id="settings-photos-heading">Shop photos</h2>
            {settings.photos.length === 0 && <p className="text-secondary">No photos yet. Upload real photos of the shop.</p>}
            <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
              {settings.photos.map((photo) => (
                <figure key={photo.id} style={{ margin: 0 }}>
                  <img src={photo.url} alt={photo.caption || 'Shop photo'} style={{ width: '100%', height: 'auto' }} />
                  <figcaption className="text-small">{photo.caption}</figcaption>
                  <button type="button" className="btn btn--sm" disabled={busy}
                    onClick={() => void run(() => deleteStorePhoto(photo.id), 'Photo removed.').then((next) => next && apply(next))}>Remove</button>
                </figure>
              ))}
            </div>
            <label htmlFor="set-photo-caption" style={{ marginTop: 16 }}>Caption (optional)</label>
            <input id="set-photo-caption" className="input" value={photoCaption} onChange={(event) => setPhotoCaption(event.target.value)} maxLength={255} disabled={busy} />
            <label htmlFor="set-photo">Add a photo</label>
            <input id="set-photo" className="input" type="file" accept="image/jpeg,image/png,image/webp" disabled={busy}
              onChange={(event) => void pickImage(event, (file) => addStorePhoto(file, photoCaption), 'Photo added.').then(() => setPhotoCaption(''))} />
          </section>
        </form>
      )}
    </div>
  );
}
