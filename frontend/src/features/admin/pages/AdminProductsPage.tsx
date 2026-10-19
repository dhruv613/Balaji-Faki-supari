import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import Notice from '../../../components/common/Notice';
import { env } from '../../../lib/env';
import { formatINR, formatPackSize, getErrorMessage } from '../../../lib/api';
import { addAdminProductImage, deleteAdminProductImage, getAdminProducts, updateAdminProduct } from '../api';
import type {
  AdminProduct,
  AdminProductVariant,
  PackSize,
  ProductInformation,
  UpdateAdminProductRequest,
} from '../types';
import { notifyAdminDataChanged } from '../lib/orderStateMachine';
import { DetailDrawer, LoadingSkeleton, useAdminToast } from '../components';

type InformationKey = keyof ProductInformation;

/** Labels follow what customers see on the product page. Empty = not published. */
const PRODUCT_INFORMATION_FIELDS: Array<{ key: InformationKey; label: string; placeholder: string }> = [
  { key: 'ingredients', label: 'Ingredients', placeholder: 'Only confirmed ingredients or composition.' },
  { key: 'popularity', label: 'What makes it popular', placeholder: 'Only a store-confirmed reason.' },
  { key: 'characteristics', label: 'Characteristics', placeholder: 'Only confirmed product characteristics.' },
  { key: 'productionPackaging', label: 'Preparation / production', placeholder: 'Only confirmed preparation details.' },
  { key: 'providerManufacturer', label: 'Manufacturer / provider', placeholder: 'Only confirmed provider or manufacturer.' },
  { key: 'packaging', label: 'Packaging', placeholder: 'Only confirmed packaging details.' },
  { key: 'safetyStorage', label: 'Storage', placeholder: 'Only confirmed storage guidance.' },
  { key: 'shelfLife', label: 'Shelf life', placeholder: 'Only if known.' },
  { key: 'safetyDisclosures', label: 'Safety information', placeholder: 'Only applicable, confirmed disclosures.' },
];

interface RowEdit {
  productId: string;
  packSize: PackSize;
  cost: string;
  price: string;
  available: boolean;
  approve: boolean;
}

/** Parses an optional rupee amount. Returns undefined for "empty", NaN-safe errors as `null`. */
function parseRupees(input: string): number | null | undefined | 'invalid' {
  const raw = input.trim();
  if (raw === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : 'invalid';
}

/** Only the variant fields that actually changed - an untouched price or availability is never sent. */
export function buildVariantPatch(
  variant: AdminProductVariant,
  edit: Pick<RowEdit, 'cost' | 'price' | 'available' | 'approve'>,
): { patch: NonNullable<UpdateAdminProductRequest['variants']>[number]; error?: string } {
  const patch: NonNullable<UpdateAdminProductRequest['variants']>[number] = { packSize: variant.packSize };
  const cost = parseRupees(edit.cost);
  const price = parseRupees(edit.price);
  if (cost === 'invalid') return { patch, error: 'Enter a valid cost price in rupees (0 or more).' };
  if (price === 'invalid') return { patch, error: 'Enter a valid selling price in rupees (0 or more).' };
  if (cost !== (variant.costPrice ?? null)) patch.costPrice = cost as number | null;
  if (price !== variant.price) patch.price = price as number | null;
  if (edit.available !== variant.isAvailable) patch.isAvailable = edit.available;
  const priceChanged = patch.price !== undefined;
  // A changed price needs fresh approval; approving is an explicit choice.
  if (edit.approve && (priceChanged || !variant.priceConfirmed)) {
    if (price === null) return { patch, error: 'Set a selling price before approving it.' };
    patch.priceConfirmed = true;
  }
  return { patch };
}

export default function AdminProductsPage() {
  const { showToast } = useAdminToast();
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [row, setRow] = useState<RowEdit | null>(null);
  const [rowBusy, setRowBusy] = useState(false);

  const [editing, setEditing] = useState<AdminProduct | null>(null);
  const [form, setForm] = useState({ name: '', nameGu: '', category: '', description: '', active: true });
  const [info, setInfo] = useState<Record<InformationKey, string>>(() => emptyInfo());
  const [busy, setBusy] = useState(false);
  const [altText, setAltText] = useState('');

  const [loading, setLoading] = useState(Boolean(env.apiBaseUrl));
  const [error, setError] = useState('');
  const [isLive, setIsLive] = useState(false);

  useEffect(() => {
    let active = true;
    if (!env.apiBaseUrl) { setLoading(false); return; }
    setLoading(true); setError('');
    getAdminProducts()
      .then((res) => { if (active) { setProducts(res); setIsLive(true); } })
      .catch((err) => { if (active) setError(getErrorMessage(err)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  function replaceProduct(updated: AdminProduct) {
    setProducts((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
    setEditing((current) => (current && current.id === updated.id ? updated : current));
    notifyAdminDataChanged();
  }

  function startRowEdit(product: AdminProduct, variant: AdminProductVariant) {
    setRow({
      productId: product.id,
      packSize: variant.packSize,
      cost: variant.costPrice !== null && variant.costPrice !== undefined ? String(variant.costPrice) : '',
      price: variant.price !== null ? String(variant.price) : '',
      available: variant.isAvailable,
      approve: variant.priceConfirmed,
    });
  }

  async function saveRow(product: AdminProduct) {
    if (!row || row.productId !== product.id || rowBusy) return;
    const variant = product.variants.find((v) => v.packSize === row.packSize);
    if (!variant) return;
    const { patch, error: invalid } = buildVariantPatch(variant, row);
    if (invalid) { showToast(invalid, 'warning'); return; }
    if (Object.keys(patch).length === 1) { setRow(null); showToast('Nothing changed.', 'info'); return; }
    setRowBusy(true);
    try {
      replaceProduct(await updateAdminProduct(product.id, { variants: [patch] }));
      setRow(null);
      showToast(`Saved ${product.name} ${formatPackSize(row.packSize)}. Price changes apply to future orders only.`, 'success');
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    } finally { setRowBusy(false); }
  }

  function openProduct(product: AdminProduct) {
    setEditing(product);
    setForm({ name: product.name, nameGu: product.nameGu, category: product.category, description: product.description, active: product.active });
    setInfo({ ...emptyInfo(), ...(product.information ?? {}) } as Record<InformationKey, string>);
    setAltText('');
  }

  async function saveProduct(event: FormEvent) {
    event.preventDefault();
    if (!editing || busy) return;
    if (form.name.trim().length < 2) { showToast('Enter a valid product name.', 'warning'); return; }
    const patch: UpdateAdminProductRequest = {};
    if (form.name.trim() !== editing.name) patch.name = form.name.trim();
    if (form.nameGu.trim() !== editing.nameGu) patch.nameGu = form.nameGu.trim();
    if (form.category.trim() !== editing.category) patch.category = form.category.trim();
    if (form.description.trim() !== editing.description) patch.description = form.description.trim();
    if (form.active !== editing.active) patch.active = form.active;
    const changedInfo: Partial<ProductInformation> = {};
    for (const { key } of PRODUCT_INFORMATION_FIELDS) {
      if (info[key].trim() !== String(editing.information?.[key] ?? '').trim()) changedInfo[key] = info[key].trim();
    }
    if (Object.keys(changedInfo).length) patch.information = changedInfo;
    if (Object.keys(patch).length === 0) { setEditing(null); return; }
    setBusy(true);
    try {
      replaceProduct(await updateAdminProduct(editing.id, patch));
      showToast(`Saved ${form.name.trim()}.`, 'success');
      setEditing(null);
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    } finally { setBusy(false); }
  }

  async function uploadImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !editing || busy) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { showToast('Choose a JPG, PNG or WEBP photo.', 'warning'); return; }
    setBusy(true);
    try {
      replaceProduct(await addAdminProductImage(editing.id, file, altText));
      setAltText('');
      showToast('Photo added.', 'success');
    } catch (err) { showToast(getErrorMessage(err), 'error'); } finally { setBusy(false); }
  }

  async function removeImage(imageId: string) {
    if (!editing || busy) return;
    setBusy(true);
    try {
      replaceProduct(await deleteAdminProductImage(editing.id, imageId));
      showToast('Photo removed.', 'success');
    } catch (err) { showToast(getErrorMessage(err), 'error'); } finally { setBusy(false); }
  }

  return (
    <div className="wrapper">
      <div className="admin-heading">
        <div>
          <h1 className="page__header">Price Management</h1>
          <p className="page__subtitle">
            Manage Faki (<span lang="gu">ફાકી</span>) and Supari (<span lang="gu">સુપારી</span>) cost prices, selling prices, availability, photos and product facts.
          </p>
        </div>
        <Link to="/admin/inventory" className="btn btn--outline btn--sm">Manage stock</Link>
      </div>

      <Notice title="Historical Order Price Protection">
        Updating prices here applies only to new orders. Existing orders keep the price they were bought at. A changed price shows as a development price until you approve it.
      </Notice>

      {!isLive && (
        <Notice tone="info" title="Server-Authoritative Pricing Policy">
          Connect the local FastAPI server to load and edit database prices. No sample product or price records are shown.
        </Notice>
      )}
      {error && <Notice tone="error" title="Price catalog sync error">{error}</Notice>}

      {loading ? (
        <LoadingSkeleton rows={6} />
      ) : (
        <section className="card" aria-labelledby="price-management-table-heading">
          <div className="detail-header">
            <h2 id="price-management-table-heading" className="admin-section-title" style={{ marginBottom: 4 }}>
              Product &amp; Pack-Size Pricing Table
            </h2>
            <div className="admin-action-group">
              {products.map((product) => (
                <button key={product.id} type="button" className="btn btn--outline btn--sm" onClick={() => openProduct(product)}>
                  Edit {product.name} details &amp; photos
                </button>
              ))}
            </div>
          </div>

          <div className="admin-table-wrap" role="region" aria-label="Product and pack-size price management table" tabIndex={0}>
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Product</th>
                  <th scope="col">Pack Size</th>
                  <th scope="col">Cost Price</th>
                  <th scope="col">Selling Price</th>
                  <th scope="col">Approval</th>
                  <th scope="col">Stock</th>
                  <th scope="col">Availability</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {products.flatMap((product) =>
                  product.variants.map((variant) => {
                    const mine = row?.productId === product.id && row?.packSize === variant.packSize ? row : null;
                    return (
                      <tr key={`${product.id}-${variant.packSize}`}>
                        <td><strong>{product.name}</strong> <span lang="gu" className="text-secondary">({product.nameGu})</span></td>
                        <td><strong>{variant.packSize}</strong></td>
                        <td>
                          {mine ? (
                            <input type="number" min="0" step="0.01" className="input admin-price-input" aria-label={`Cost Price for ${product.name} ${variant.packSize}`}
                              placeholder="Cost price (₹)" value={mine.cost} disabled={rowBusy}
                              onChange={(e) => setRow((prev) => (prev ? { ...prev, cost: e.target.value } : null))} />
                          ) : variant.costPrice !== null && variant.costPrice !== undefined ? <strong>{formatINR(variant.costPrice)}</strong>
                            : <span className="text-secondary">Not configured</span>}
                        </td>
                        <td>
                          {mine ? (
                            <input type="number" min="0" step="0.01" className="input admin-price-input" aria-label={`Selling Price for ${product.name} ${variant.packSize}`}
                              placeholder="Selling price (₹)" value={mine.price} disabled={rowBusy}
                              onChange={(e) => setRow((prev) => (prev ? { ...prev, price: e.target.value } : null))} />
                          ) : <strong>{variant.price === null ? 'Awaiting price' : formatINR(variant.price)}</strong>}
                        </td>
                        <td>
                          {mine ? (
                            <label style={{ margin: 0, fontSize: 14 }}>
                              <input type="checkbox" checked={mine.approve} disabled={rowBusy}
                                onChange={(e) => setRow((prev) => (prev ? { ...prev, approve: e.target.checked } : null))} /> Approved
                            </label>
                          ) : variant.price === null ? <span className="text-secondary">—</span>
                            : variant.priceConfirmed ? <span className="badge badge--green">Approved</span>
                              : <span className="badge badge--dev" title="Development price: not yet approved by the owner">Development price</span>}
                        </td>
                        <td>{variant.availableQuantity} <span className="text-small text-secondary">({variant.reservedQuantity} held)</span></td>
                        <td>
                          {mine ? (
                            <label style={{ margin: 0, fontSize: 14 }}>
                              <input type="checkbox" checked={mine.available} disabled={rowBusy}
                                onChange={(e) => setRow((prev) => (prev ? { ...prev, available: e.target.checked } : null))} /> On sale
                            </label>
                          ) : variant.isAvailable ? 'On sale' : <span className="text-secondary">Off sale</span>}
                        </td>
                        <td>
                          {mine ? (
                            <div className="admin-action-group">
                              <button type="button" className="btn btn--primary btn--sm" disabled={rowBusy} onClick={() => void saveRow(product)}>{rowBusy ? 'Saving…' : 'Save'}</button>
                              <button type="button" className="btn btn--outline btn--sm" disabled={rowBusy} onClick={() => setRow(null)}>Cancel</button>
                            </div>
                          ) : (
                            <button type="button" className="btn btn--outline btn--sm" onClick={() => startRowEdit(product, variant)}>Edit</button>
                          )}
                        </td>
                      </tr>
                    );
                  }),
                )}
                {products.length === 0 && (
                  <tr><td colSpan={8} className="text-secondary">No products are available from the local catalog yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <DetailDrawer open={editing !== null} title={`Edit ${editing?.name ?? 'product'}`} subtitle="Details and photos shown on the customer product page." onClose={() => setEditing(null)}>
        {editing && (
          <form onSubmit={saveProduct}>
            <div className="form-row">
              <div>
                <label htmlFor="prod-name">Product name (English)</label>
                <input id="prod-name" className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
              </div>
              <div>
                <label htmlFor="prod-name-gu">Product name (ગુજરાતી)</label>
                <input id="prod-name-gu" className="input" lang="gu" value={form.nameGu} onChange={(e) => setForm({ ...form, nameGu: e.target.value })} />
              </div>
            </div>
            <label htmlFor="prod-category">Category</label>
            <input id="prod-category" className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} required />
            <label htmlFor="prod-description">Description</label>
            <textarea id="prod-description" className="input" value={form.description} maxLength={2000}
              onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Only store-confirmed information." />
            <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Visible to customers
            </label>

            <fieldset style={{ marginTop: 16 }}>
              <legend>Confirmed product information</legend>
              <p className="text-small text-secondary">Leave a field blank until the shop confirms it; blank facts are hidden from customers.</p>
              {PRODUCT_INFORMATION_FIELDS.map(({ key, label, placeholder }) => (
                <div key={key} style={{ marginTop: 12 }}>
                  <label htmlFor={`prod-info-${key}`}>{label}</label>
                  <textarea id={`prod-info-${key}`} className="input" value={info[key]} maxLength={2000} placeholder={placeholder}
                    onChange={(event) => setInfo((current) => ({ ...current, [key]: event.target.value }))} />
                </div>
              ))}
            </fieldset>

            <fieldset style={{ marginTop: 16 }}>
              <legend>Photos</legend>
              {editing.images.length === 0 && <p className="text-secondary text-small">No photos uploaded. The bundled catalogue image is shown until you add one.</p>}
              <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))' }}>
                {editing.images.map((image) => (
                  <figure key={image.id} style={{ margin: 0 }}>
                    <img src={image.url} alt={image.alt} loading="lazy" style={{ width: '100%', aspectRatio: '4 / 5', objectFit: 'contain', background: '#fff', border: '1px solid var(--color-border)' }} />
                    <button type="button" className="btn btn--sm" disabled={busy} onClick={() => void removeImage(image.id)}>Remove</button>
                  </figure>
                ))}
              </div>
              <label htmlFor="prod-image-alt" style={{ marginTop: 12 }}>Photo description (for screen readers)</label>
              <input id="prod-image-alt" className="input" value={altText} onChange={(e) => setAltText(e.target.value)} maxLength={255} disabled={busy} />
              <label htmlFor="prod-image-file">Add a photo (JPG, PNG or WEBP, 4 MB max)</label>
              <input id="prod-image-file" className="input" type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={(e) => void uploadImage(e)} />
            </fieldset>

            <div className="admin-modal__actions">
              <button type="button" className="btn btn--outline btn--sm" onClick={() => setEditing(null)}>Cancel</button>
              <button type="submit" className="btn btn--primary btn--sm" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
            </div>
          </form>
        )}
      </DetailDrawer>
    </div>
  );
}

function emptyInfo(): Record<InformationKey, string> {
  return {
    ingredients: '', popularity: '', characteristics: '', productionPackaging: '', providerManufacturer: '', safetyStorage: '',
    shelfLife: '', packaging: '', safetyDisclosures: '',
  };
}
