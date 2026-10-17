import { useEffect, useState, type FormEvent } from 'react';
import Notice from '../../../components/common/Notice';
import { env } from '../../../lib/env';
import { formatINR, formatPackSize, getErrorMessage } from '../../../lib/api';
import {
  getAdminProducts,
  createAdminProduct,
  updateAdminProduct,
} from '../api';
import type { AdminProduct, AdminProductVariant, PackSize, ProductType } from '../types';
import { SAMPLE_ADMIN_PRODUCTS } from '../lib/referenceData';
import { notifyAdminDataChanged } from '../lib/orderStateMachine';
import { DetailDrawer, LoadingSkeleton, useAdminToast } from '../components';

interface EditingRowState {
  productId: string;
  variantId: string;
  packSize: PackSize;
  costPriceInput: string;
  sellingPriceInput: string;
}

export default function AdminProductsPage() {
  const { showToast } = useAdminToast();
  const [products, setProducts] = useState<AdminProduct[]>(SAMPLE_ADMIN_PRODUCTS);

  // Inline table row editing state for Cost Price & Selling Price
  const [editingRow, setEditingRow] = useState<EditingRowState | null>(null);
  const [rowBusy, setRowBusy] = useState(false);

  // Full product drawer state (preserves catalog management capability)
  const [editingProduct, setEditingProduct] = useState<AdminProduct | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [formType, setFormType] = useState<ProductType>('faki');
  const [formName, setFormName] = useState('');
  const [formNameGu, setFormNameGu] = useState('');
  const [formCategory, setFormCategory] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formDescriptionGu, setFormDescriptionGu] = useState('');
  const [formImageUrl, setFormImageUrl] = useState('/images/hero-product.jpg');
  const [formActive, setFormActive] = useState(true);
  const [variantCostPrices, setVariantCostPrices] = useState<Record<PackSize, string>>({
    '250g': '',
    '500g': '',
    '1kg': '',
  });
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

  function startRowEdit(product: AdminProduct, variant: AdminProductVariant) {
    setEditingRow({
      productId: product.id,
      variantId: variant.id,
      packSize: variant.packSize,
      costPriceInput:
        variant.costPrice !== null && variant.costPrice !== undefined
          ? String(variant.costPrice)
          : '',
      sellingPriceInput: variant.price !== null ? String(variant.price) : '',
    });
  }

  function cancelRowEdit() {
    setEditingRow(null);
  }

  async function saveRowEdit(product: AdminProduct) {
    if (!editingRow || editingRow.productId !== product.id) return;

    const rawCost = editingRow.costPriceInput.trim();
    const rawSelling = editingRow.sellingPriceInput.trim();

    const parsedCost = rawCost === '' ? null : Number(rawCost);
    const parsedSelling = rawSelling === '' ? null : Number(rawSelling);

    if (parsedCost !== null && (!Number.isFinite(parsedCost) || parsedCost < 0)) {
      showToast('Enter a valid non-negative Cost Price in INR.', 'warning');
      return;
    }
    if (parsedSelling !== null && (!Number.isFinite(parsedSelling) || parsedSelling < 0)) {
      showToast('Enter a valid non-negative Selling Price in INR.', 'warning');
      return;
    }

    const updatedVariants = product.variants.map((v) => {
      if (v.packSize !== editingRow.packSize) {
        return {
          packSize: v.packSize,
          sku: v.sku,
          costPrice: v.costPrice ?? null,
          price: v.price,
          availableQuantity: v.availableQuantity,
          isAvailable: v.isAvailable,
        };
      }
      return {
        packSize: v.packSize,
        sku: v.sku,
        costPrice: parsedCost,
        price: parsedSelling,
        availableQuantity: v.availableQuantity,
        isAvailable: v.isAvailable,
      };
    });

    if (!env.apiBaseUrl) {
      showToast(
        'Integration pending: FastAPI (/api/admin/products) is not connected. Price changes require backend persistence.',
        'warning',
      );
      return;
    }

    setRowBusy(true);
    try {
      const updated = await updateAdminProduct(product.id, {
        variants: updatedVariants,
      });
      setProducts((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      setEditingRow(null);
      notifyAdminDataChanged();
      showToast(
        `Saved ${product.name} (${editingRow.packSize}) Cost & Selling Prices.`,
        'success',
      );
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    } finally {
      setRowBusy(false);
    }
  }

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

    const costs: Record<PackSize, string> = { '250g': '', '500g': '', '1kg': '' };
    const prices: Record<PackSize, string> = { '250g': '', '500g': '', '1kg': '' };
    const stocks: Record<PackSize, string> = { '250g': '0', '500g': '0', '1kg': '0' };
    const avail: Record<PackSize, boolean> = { '250g': true, '500g': true, '1kg': true };
    for (const v of product.variants) {
      costs[v.packSize] =
        v.costPrice !== null && v.costPrice !== undefined ? String(v.costPrice) : '';
      prices[v.packSize] = v.price !== null ? String(v.price) : '';
      stocks[v.packSize] = String(v.availableQuantity);
      avail[v.packSize] = v.isAvailable;
    }
    setVariantCostPrices(costs);
    setVariantPrices(prices);
    setVariantStock(stocks);
    setVariantAvailable(avail);
  }

  async function handleSaveProduct(e: FormEvent) {
    e.preventDefault();
    if (formName.trim().length < 2) {
      showToast('Enter a valid product name.', 'warning');
      return;
    }

    const packSizes: PackSize[] = ['250g', '500g', '1kg'];
    const parsedVariants = packSizes.map((size) => {
      const rawCost = variantCostPrices[size].trim();
      const costVal = rawCost === '' ? null : Number(rawCost);
      const rawPrice = variantPrices[size].trim();
      const priceVal = rawPrice === '' ? null : Number(rawPrice);
      const stockVal = Math.max(0, Math.trunc(Number(variantStock[size]) || 0));
      return {
        packSize: size,
        sku: `BFP-${formType.toUpperCase()}-${size.toUpperCase()}`,
        costPrice: costVal !== null && Number.isFinite(costVal) && costVal >= 0 ? costVal : null,
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
        notifyAdminDataChanged();
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
        notifyAdminDataChanged();
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
          <h1 className="page__header">Price Management</h1>
          <p className="page__subtitle">
            Manage Faki (<span lang="gu">ફાકી</span>) and Supari (<span lang="gu">સુપારી</span>) pack-size Cost Prices and Selling Prices (250g · 500g · 1kg).
          </p>
        </div>
      </div>

      <Notice title="Historical Order Price Protection">
        Cost Price and Selling Price are stored separately per pack size. Updating prices here applies only to new orders — existing customer orders always retain their original purchased prices.
      </Notice>

      {!isLive && (
        <Notice tone="info" title="Server-Authoritative Pricing Policy">
          FastAPI (<code>/api/admin/products</code>) is not connected yet. Unconfigured prices display <strong>Not configured</strong> / <strong>Awaiting price</strong> until saved in PostgreSQL through FastAPI.
        </Notice>
      )}
      {error && <Notice tone="error" title="Price catalog sync error">{error}</Notice>}

      {loading ? (
        <LoadingSkeleton rows={6} />
      ) : (
        <section className="card" aria-labelledby="price-management-table-heading">
          <div className="detail-header">
            <div>
              <h2 id="price-management-table-heading" className="admin-section-title" style={{ marginBottom: 4 }}>
                Product &amp; Pack-Size Pricing Table
              </h2>
              <p className="text-small text-secondary">
                Edit Cost Price and Selling Price for each pack size (250g, 500g, 1kg) and save changes to the backend.
              </p>
            </div>
            <div className="admin-action-group">
              {products.map((product) => (
                <button
                  key={product.id}
                  type="button"
                  className="btn btn--outline btn--sm"
                  onClick={() => openEditDrawer(product)}
                >
                  Edit {product.name} Details
                </button>
              ))}
            </div>
          </div>

          <div
            className="admin-table-wrap"
            role="region"
            aria-label="Product and pack-size price management table"
            tabIndex={0}
          >
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Product</th>
                  <th scope="col">Pack Size</th>
                  <th scope="col">Cost Price</th>
                  <th scope="col">Selling Price</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {products.flatMap((product) =>
                  product.variants.map((variant) => {
                    const isEditingThisRow =
                      editingRow?.productId === product.id &&
                      editingRow?.packSize === variant.packSize;

                    return (
                      <tr key={`${product.id}-${variant.packSize}`}>
                        <td>
                          <strong>{product.name}</strong>{' '}
                          <span lang="gu" className="text-secondary">
                            ({product.nameGu})
                          </span>
                        </td>
                        <td>
                          <strong>{variant.packSize}</strong>
                        </td>
                        <td>
                          {isEditingThisRow ? (
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              className="input admin-price-input"
                              aria-label={`Cost Price for ${product.name} ${variant.packSize}`}
                              placeholder="Cost price (₹)"
                              value={editingRow.costPriceInput}
                              onChange={(e) =>
                                setEditingRow((prev) =>
                                  prev ? { ...prev, costPriceInput: e.target.value } : null,
                                )
                              }
                              disabled={rowBusy}
                            />
                          ) : variant.costPrice !== null && variant.costPrice !== undefined ? (
                            <strong>{formatINR(variant.costPrice)}</strong>
                          ) : (
                            <span className="text-secondary">Not configured</span>
                          )}
                        </td>
                        <td>
                          {isEditingThisRow ? (
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              className="input admin-price-input"
                              aria-label={`Selling Price for ${product.name} ${variant.packSize}`}
                              placeholder="Selling price (₹)"
                              value={editingRow.sellingPriceInput}
                              onChange={(e) =>
                                setEditingRow((prev) =>
                                  prev ? { ...prev, sellingPriceInput: e.target.value } : null,
                                )
                              }
                              disabled={rowBusy}
                            />
                          ) : (
                            <strong>{formatINR(variant.price)}</strong>
                          )}
                        </td>
                        <td>
                          {isEditingThisRow ? (
                            <div className="admin-action-group">
                              <button
                                type="button"
                                className="btn btn--primary btn--sm"
                                disabled={rowBusy}
                                onClick={() => void saveRowEdit(product)}
                              >
                                {rowBusy ? 'Saving…' : 'Save'}
                              </button>
                              <button
                                type="button"
                                className="btn btn--outline btn--sm"
                                disabled={rowBusy}
                                onClick={cancelRowEdit}
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              className="btn btn--outline btn--sm"
                              onClick={() => startRowEdit(product, variant)}
                            >
                              Edit
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  }),
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Full Product & Variant Editor Drawer */}
      <DetailDrawer
        open={isCreating || editingProduct !== null}
        title={isCreating ? 'Add Product' : `Edit ${editingProduct?.name ?? 'Product'}`}
        subtitle="Configure product details, Cost Prices, and Selling Prices for 250g, 500g, and 1kg."
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

          <h3 style={{ fontSize: 18, margin: '20px 0 10px' }}>
            Pack-Size Cost &amp; Selling Prices (250g · 500g · 1kg)
          </h3>

          {(['250g', '500g', '1kg'] as PackSize[]).map((size) => (
            <div key={size} className="card card--tinted" style={{ padding: 14, marginBottom: 12 }}>
              <div className="detail-header">
                <strong>Pack Size: {formatPackSize(size)}</strong>
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
                  <label htmlFor={`cost-${size}`}>Cost Price (₹ INR)</label>
                  <input
                    id={`cost-${size}`}
                    type="number"
                    min="0"
                    step="0.01"
                    className="input"
                    placeholder="Not configured"
                    value={variantCostPrices[size]}
                    onChange={(e) =>
                      setVariantCostPrices((prev) => ({ ...prev, [size]: e.target.value }))
                    }
                  />
                </div>
                <div>
                  <label htmlFor={`price-${size}`}>Selling Price (₹ INR)</label>
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
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </DetailDrawer>
    </div>
  );
}
