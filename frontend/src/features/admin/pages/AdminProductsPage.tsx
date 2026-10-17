import { useEffect, useState, type FormEvent } from 'react';
import Notice from '../../../components/common/Notice';
import { env } from '../../../lib/env';
import { formatINR, formatPackSize, getErrorMessage } from '../../../lib/api';
import {
  getAdminProducts,
  createAdminProduct,
  updateAdminProduct,
} from '../api';
import type { AdminProduct, PackSize, ProductType } from '../types';
import { SAMPLE_ADMIN_PRODUCTS } from '../lib/referenceData';
import { DetailDrawer, LoadingSkeleton, useAdminToast } from '../components';

export default function AdminProductsPage() {
  const { showToast } = useAdminToast();
  const [products, setProducts] = useState<AdminProduct[]>(SAMPLE_ADMIN_PRODUCTS);
  const [editingProduct, setEditingProduct] = useState<AdminProduct | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  // Form states for Add / Edit Product
  const [formType, setFormType] = useState<ProductType>('faki');
  const [formName, setFormName] = useState('');
  const [formNameGu, setFormNameGu] = useState('');
  const [formCategory, setFormCategory] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formDescriptionGu, setFormDescriptionGu] = useState('');
  const [formImageUrl, setFormImageUrl] = useState('/images/hero-product.jpg');
  const [formActive, setFormActive] = useState(true);
  const [variantPrices, setVariantPrices] = useState<Record<PackSize, string>>({
    '250g': '',
    '500g': '',
    '1kg': '',
  });
  const [variantStock, setVariantStock] = useState<Record<PackSize, string>>({
    '250g': '0',
    '500g': '0',
    '1kg': '0',
  });
  const [variantAvailable, setVariantAvailable] = useState<Record<PackSize, boolean>>({
    '250g': true,
    '500g': true,
    '1kg': true,
  });
  const [busy, setBusy] = useState(false);

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
    getAdminProducts()
      .then((res) => {
        if (active) {
          setProducts(res);
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

  function openEditDrawer(product: AdminProduct) {
    setIsCreating(false);
    setEditingProduct(product);
    setFormType(product.type);
    setFormName(product.name);
    setFormNameGu(product.nameGu);
    setFormCategory(product.category);
    setFormDescription(product.description);
    setFormDescriptionGu(product.descriptionGu ?? '');
    setFormImageUrl(product.imageUrl);
    setFormActive(product.active);

    const prices: Record<PackSize, string> = { '250g': '', '500g': '', '1kg': '' };
    const stocks: Record<PackSize, string> = { '250g': '0', '500g': '0', '1kg': '0' };
    const avail: Record<PackSize, boolean> = { '250g': true, '500g': true, '1kg': true };
    for (const v of product.variants) {
      prices[v.packSize] = v.price !== null ? String(v.price) : '';
      stocks[v.packSize] = String(v.availableQuantity);
      avail[v.packSize] = v.isAvailable;
    }
    setVariantPrices(prices);
    setVariantStock(stocks);
    setVariantAvailable(avail);
  }

  function openAddDrawer() {
    setIsCreating(true);
    setEditingProduct(null);
    setFormType('faki');
    setFormName('');
    setFormNameGu('');
    setFormCategory('Traditional Blend');
    setFormDescription('');
    setFormDescriptionGu('');
    setFormImageUrl('/images/hero-product.jpg');
    setFormActive(true);
    setVariantPrices({ '250g': '', '500g': '', '1kg': '' });
    setVariantStock({ '250g': '0', '500g': '0', '1kg': '0' });
    setVariantAvailable({ '250g': true, '500g': true, '1kg': true });
  }

  async function handleSaveProduct(e: FormEvent) {
    e.preventDefault();
    if (formName.trim().length < 2) {
      showToast('Enter a valid product name.', 'warning');
      return;
    }

    const packSizes: PackSize[] = ['250g', '500g', '1kg'];
    const parsedVariants = packSizes.map((size) => {
      const rawPrice = variantPrices[size].trim();
      const priceVal = rawPrice === '' ? null : Number(rawPrice);
      const stockVal = Math.max(0, Math.trunc(Number(variantStock[size]) || 0));
      return {
        packSize: size,
        sku: `BFP-${formType.toUpperCase()}-${size.toUpperCase()}`,
        price: priceVal !== null && Number.isFinite(priceVal) && priceVal >= 0 ? priceVal : null,
        availableQuantity: stockVal,
        isAvailable: variantAvailable[size],
      };
    });

    if (!env.apiBaseUrl) {
      showToast(
        'Integration pending: FastAPI (/api/admin/products) is not connected. Product & variant price updates require backend database persistence.',
        'warning',
      );
      return;
    }

    setBusy(true);
    try {
      if (isCreating) {
        const created = await createAdminProduct({
          type: formType,
          name: formName.trim(),
          nameGu: formNameGu.trim(),
          category: formCategory.trim(),
          description: formDescription.trim(),
          descriptionGu: formDescriptionGu.trim() || undefined,
          imageUrl: formImageUrl.trim(),
          active: formActive,
          variants: parsedVariants,
        });
        setProducts((prev) => [...prev, created]);
        showToast(`Created product ${created.name}.`, 'success');
      } else if (editingProduct) {
        const updated = await updateAdminProduct(editingProduct.id, {
          name: formName.trim(),
          nameGu: formNameGu.trim(),
          category: formCategory.trim(),
          description: formDescription.trim(),
          descriptionGu: formDescriptionGu.trim() || undefined,
          imageUrl: formImageUrl.trim(),
          active: formActive,
          variants: parsedVariants,
        });
        setProducts((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
        showToast(`Updated product ${updated.name}.`, 'success');
      }
      setEditingProduct(null);
      setIsCreating(false);
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="wrapper">
      <div className="admin-heading">
        <div>
          <h1 className="page__header">Product &amp; Variant Catalog</h1>
          <p className="page__subtitle">
            Manage Faki (<span lang="gu">ફાકી</span>) and Supari (<span lang="gu">સુપારી</span>) pack variants, prices, and store availability.
          </p>
        </div>
        <button type="button" className="btn btn--primary" onClick={openAddDrawer}>
          + Add Product
        </button>
      </div>

      {!isLive && (
        <Notice title="Server-Authoritative Pricing Policy">
          FastAPI (<code>/api/admin/products</code>) is not connected yet. Final product prices are never invented or hardcoded in the frontend — unconfigured variant prices show <strong>Awaiting price</strong> until saved in PostgreSQL through FastAPI.
        </Notice>
      )}
      {error && <Notice tone="error" title="Catalog sync error">{error}</Notice>}

      {loading ? (
        <LoadingSkeleton rows={4} />
      ) : (
        <div className="grid">
          {products.map((product) => (
            <article key={product.id} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
                <img
                  src={product.imageUrl}
                  alt={product.name}
                  style={{
                    width: 96,
                    height: 96,
                    objectFit: 'cover',
                    borderRadius: 16,
                    border: '1px solid var(--color-border)',
                  }}
                />
                <div style={{ flex: 1 }}>
                  <div className="detail-header" style={{ marginBottom: 4 }}>
                    <h2 style={{ fontSize: 32, color: 'var(--color-primary-dark)' }}>
                      {product.name}{' '}
                      <span lang="gu" style={{ fontSize: 22, color: 'var(--color-text-secondary)' }}>
                        ({product.nameGu})
                      </span>
                    </h2>
                    <span className={`badge ${product.active ? 'badge--green' : 'badge--outline'}`}>
                      {product.active ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <p className="text-small text-secondary">{product.category}</p>
                  <p style={{ marginTop: 6 }}>{product.description}</p>
                  {product.descriptionGu && (
                    <p className="text-small text-secondary" lang="gu" style={{ marginTop: 4 }}>
                      {product.descriptionGu}
                    </p>
                  )}
                </div>
              </div>

              <div>
                <h3 style={{ fontSize: 16, marginBottom: 8 }}>
                  Independently Managed Pack Variants (250 g · 500 g · 1 kg)
                </h3>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col">Variant</th>
                      <th scope="col">SKU</th>
                      <th scope="col">Unit Price</th>
                      <th scope="col">Available Stock</th>
                      <th scope="col">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {product.variants.map((variant) => (
                      <tr key={variant.id}>
                        <td><strong>{formatPackSize(variant.packSize)}</strong></td>
                        <td><code className="text-small">{variant.sku}</code></td>
                        <td><strong>{formatINR(variant.price)}</strong></td>
                        <td>{variant.availableQuantity} packs</td>
                        <td>
                          <span
                            className={`badge ${
                              variant.isAvailable ? 'badge--green' : 'badge--outline'
                            }`}
                          >
                            {variant.isAvailable ? 'Available' : 'Unavailable'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="detail-header" style={{ marginTop: 'auto', paddingTop: 8 }}>
                <span className="text-small text-secondary">Last updated: {product.updatedAt}</span>
                <button
                  type="button"
                  className="btn btn--dark btn--sm"
                  onClick={() => openEditDrawer(product)}
                >
                  Edit Product &amp; Variants
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {/* Add / Edit Product Drawer */}
      <DetailDrawer
        open={isCreating || editingProduct !== null}
        title={isCreating ? 'Add Product' : `Edit ${editingProduct?.name ?? 'Product'}`}
        subtitle="Configure product details, Gujarati name, and per-variant pricing & stock."
        onClose={() => {
          setIsCreating(false);
          setEditingProduct(null);
        }}
      >
        <form onSubmit={handleSaveProduct}>
          <div className="form-row">
            <div>
              <label htmlFor="prod-type">Product Type Key</label>
              <select
                id="prod-type"
                className="input"
                value={formType}
                onChange={(e) => setFormType(e.target.value as ProductType)}
                disabled={!isCreating}
              >
                <option value="faki">faki (Faki)</option>
                <option value="supari">supari (Supari)</option>
              </select>
            </div>
            <div>
              <label htmlFor="prod-category">Product Category</label>
              <input
                id="prod-category"
                className="input"
                value={formCategory}
                onChange={(e) => setFormCategory(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="form-row">
            <div>
              <label htmlFor="prod-name">Product Name (English)</label>
              <input
                id="prod-name"
                className="input"
                placeholder="e.g. Faki"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                required
              />
            </div>
            <div>
              <label htmlFor="prod-name-gu">Product Name (Gujarati / ગુજરાતી)</label>
              <input
                id="prod-name-gu"
                className="input"
                lang="gu"
                placeholder="e.g. ફાકી"
                value={formNameGu}
                onChange={(e) => setFormNameGu(e.target.value)}
                required
              />
            </div>
          </div>

          <div style={{ marginBottom: 14 }}>
            <label htmlFor="prod-image">Product Image Path / Supabase Storage URL</label>
            <input
              id="prod-image"
              className="input"
              value={formImageUrl}
              onChange={(e) => setFormImageUrl(e.target.value)}
            />
          </div>

          <div style={{ marginBottom: 14 }}>
            <label htmlFor="prod-desc">Description (English)</label>
            <textarea
              id="prod-desc"
              className="input"
              value={formDescription}
              onChange={(e) => setFormDescription(e.target.value)}
            />
          </div>

          <div style={{ marginBottom: 14 }}>
            <label htmlFor="prod-desc-gu">Description (Gujarati / ગુજરાતી)</label>
            <input
              id="prod-desc-gu"
              className="input"
              lang="gu"
              value={formDescriptionGu}
              onChange={(e) => setFormDescriptionGu(e.target.value)}
            />
          </div>

          <div className="checkbox-row">
            <input
              id="prod-active"
              type="checkbox"
              checked={formActive}
              onChange={(e) => setFormActive(e.target.checked)}
            />
            <label htmlFor="prod-active" style={{ marginBottom: 0 }}>
              Product Active on Customer Storefront
            </label>
          </div>

          <h3 style={{ fontSize: 18, margin: '20px 0 10px' }}>
            Variant Pricing &amp; Inventory (250g · 500g · 1kg)
          </h3>
          <p className="text-small text-secondary" style={{ marginBottom: 12 }}>
            Leave price empty to keep as <strong>Awaiting price</strong>. Each variant has an independently managed price and stock quantity.
          </p>

          {(['250g', '500g', '1kg'] as PackSize[]).map((size) => (
            <div key={size} className="card card--tinted" style={{ padding: 14, marginBottom: 12 }}>
              <div className="detail-header">
                <strong>Variant: {formatPackSize(size)}</strong>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, margin: 0, fontSize: 14 }}>
                  <input
                    type="checkbox"
                    checked={variantAvailable[size]}
                    onChange={(e) =>
                      setVariantAvailable((prev) => ({ ...prev, [size]: e.target.checked }))
                    }
                  />
                  Available
                </label>
              </div>
              <div className="form-row" style={{ marginBottom: 0 }}>
                <div>
                  <label htmlFor={`price-${size}`}>Unit Price (₹ INR)</label>
                  <input
                    id={`price-${size}`}
                    type="number"
                    min="0"
                    step="0.01"
                    className="input"
                    placeholder="Awaiting price"
                    value={variantPrices[size]}
                    onChange={(e) =>
                      setVariantPrices((prev) => ({ ...prev, [size]: e.target.value }))
                    }
                  />
                </div>
                <div>
                  <label htmlFor={`stock-${size}`}>Available Stock (Packs)</label>
                  <input
                    id={`stock-${size}`}
                    type="number"
                    min="0"
                    step="1"
                    className="input"
                    value={variantStock[size]}
                    onChange={(e) =>
                      setVariantStock((prev) => ({ ...prev, [size]: e.target.value }))
                    }
                  />
                </div>
              </div>
            </div>
          ))}

          <div className="admin-modal__actions">
            <button
              type="button"
              className="btn btn--outline btn--sm"
              onClick={() => {
                setIsCreating(false);
                setEditingProduct(null);
              }}
            >
              Cancel
            </button>
            <button type="submit" className="btn btn--primary btn--sm" disabled={busy}>
              {busy ? 'Saving…' : 'Save Product & Variants'}
            </button>
          </div>
        </form>
      </DetailDrawer>
    </div>
  );
}
