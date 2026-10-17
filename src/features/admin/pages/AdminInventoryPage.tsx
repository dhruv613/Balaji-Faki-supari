import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import Notice from '../../../components/common/Notice';
import { env } from '../../../lib/env';
import { formatPackSize, getErrorMessage } from '../../../lib/api';
import { getAdminInventory, createStockAdjustment } from '../api';
import type { AdminInventoryItem, AdminInventoryResponse } from '../types';
import { SAMPLE_ADMIN_INVENTORY } from '../lib/referenceData';
import { validateStockAdjustment } from '../lib/orderStateMachine';
import { StatCard, DetailDrawer, LoadingSkeleton, useAdminToast } from '../components';

export default function AdminInventoryPage() {
  const [searchParams] = useSearchParams();
  const { showToast } = useAdminToast();

  const initialLowStockOnly = searchParams.get('filter') === 'low_stock';

  const [inventory, setInventory] = useState<AdminInventoryResponse>(SAMPLE_ADMIN_INVENTORY);
  const [query, setQuery] = useState('');
  const [lowStockOnly, setLowStockOnly] = useState(initialLowStockOnly);

  const [adjustingItem, setAdjustingItem] = useState<AdminInventoryItem | null>(null);
  const [adjustmentType, setAdjustmentType] = useState<'ADD' | 'DEDUCT'>('ADD');
  const [adjustmentQty, setAdjustmentQty] = useState('10');
  const [adjustmentReason, setAdjustmentReason] = useState('');
  const [validationError, setValidationError] = useState('');
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
    getAdminInventory()
      .then((res) => {
        if (active) {
          setInventory(res);
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

  const filteredItems = inventory.items.filter((item) => {
    if (lowStockOnly && !item.isLowStock) return false;
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return `${item.productName} ${item.productNameGu} ${item.packSize} ${item.sku}`
      .toLowerCase()
      .includes(q);
  });

  function openAdjustmentModal(item: AdminInventoryItem) {
    setAdjustingItem(item);
    setAdjustmentType('ADD');
    setAdjustmentQty('10');
    setAdjustmentReason('');
    setValidationError('');
  }

  async function handleStockAdjustment(e: FormEvent) {
    e.preventDefault();
    if (!adjustingItem) return;
    setValidationError('');

    const qty = Number(adjustmentQty);
    const requestPayload = {
      inventoryItemId: adjustingItem.id,
      productId: adjustingItem.productId,
      packSize: adjustingItem.packSize,
      adjustmentType,
      quantity: qty,
      reason: adjustmentReason.trim(),
    };

    const check = validateStockAdjustment({
      currentAvailableStock: adjustingItem.availableStock,
      request: requestPayload,
    });

    if (!check.allowed) {
      setValidationError(check.reason ?? 'Invalid stock adjustment.');
      return;
    }

    if (!env.apiBaseUrl) {
      setValidationError(
        'Integration Pending: FastAPI (POST /api/admin/inventory/adjustments) is not connected. Manual stock adjustments require backend database transactions and admin audit logging.',
      );
      showToast('Stock adjustment blocked: FastAPI backend is not connected.', 'warning');
      return;
    }

    setBusy(true);
    try {
      const movement = await createStockAdjustment(requestPayload);
      setInventory((prev) => ({
        ...prev,
        movements: [movement, ...prev.movements],
      }));
      showToast(
        `Adjusted stock for ${adjustingItem.productName} (${adjustingItem.packSize}).`,
        'success',
      );
      setAdjustingItem(null);
    } catch (err) {
      setValidationError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="wrapper">
      <div className="admin-heading">
        <div>
          <h1 className="page__header">Stock &amp; Inventory Management</h1>
          <p className="page__subtitle">
            Monitor available and reserved pack quantities, low-stock alerts, and movement audit logs.
          </p>
        </div>
        <span className="badge badge--info">
          Reservation Expiry Policy: {inventory.summary.reservationExpiryMinutes} mins
        </span>
      </div>

      {!isLive && (
        <Notice title="Inventory Integrity Rules">
          FastAPI (<code>/api/admin/inventory</code>) is not connected yet. Rules enforced: Available stock can never become negative, confirming an order validates available stock, cancelled orders release reservations, and double stock deductions are prevented.
        </Notice>
      )}
      {error && <Notice tone="error" title="Inventory sync failed">{error}</Notice>}

      <div className="stats-grid">
        <StatCard
          label="Total Stock (Packs)"
          value={inventory.summary.totalStockUnits}
          subtitle="Available + Reserved"
        />
        <StatCard
          label="Available Stock"
          value={inventory.summary.availableStockUnits}
          subtitle="Ready for new orders"
        />
        <StatCard
          label="Reserved Stock"
          value={inventory.summary.reservedStockUnits}
          subtitle={`Expires after ${inventory.summary.reservationExpiryMinutes}m if unpaid`}
        />
        <StatCard
          label="Low Stock Alerts"
          value={inventory.summary.lowStockAlertsCount}
          subtitle="Variants below threshold"
        />
      </div>

      {/* Search & Filters */}
      <div className="card card--tinted customer-filters">
        <div style={{ flex: '2 1 280px' }}>
          <label htmlFor="inv-search">Search Product, Pack Size, or SKU</label>
          <input
            id="inv-search"
            type="search"
            className="input"
            placeholder="Faki, Supari, 1kg, or BFP-FAKI-1KG…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="customer-filter-chips">
          <button
            type="button"
            className={`chip${!lowStockOnly ? ' chip--active' : ''}`}
            aria-pressed={!lowStockOnly}
            onClick={() => setLowStockOnly(false)}
          >
            All Variants ({inventory.items.length})
          </button>
          <button
            type="button"
            className={`chip${lowStockOnly ? ' chip--active' : ''}`}
            aria-pressed={lowStockOnly}
            onClick={() => setLowStockOnly(true)}
          >
            Low Stock Alerts ({inventory.summary.lowStockAlertsCount})
          </button>
        </div>
      </div>

      {loading ? (
        <LoadingSkeleton rows={5} />
      ) : (
        <>
          <div className="card" style={{ marginBottom: 24 }}>
            <div className="customer-table-scroll" role="region" aria-label="Variant stock levels" tabIndex={0}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Product &amp; Variant</th>
                    <th scope="col">SKU</th>
                    <th scope="col">Total Stock</th>
                    <th scope="col">Available Stock</th>
                    <th scope="col">Reserved Stock</th>
                    <th scope="col">Threshold</th>
                    <th scope="col">Alert Status</th>
                    <th scope="col">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredItems.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <strong>
                          {item.productName} (<span lang="gu">{item.productNameGu}</span>) ·{' '}
                          {formatPackSize(item.packSize)}
                        </strong>
                      </td>
                      <td><code className="text-small">{item.sku}</code></td>
                      <td>{item.totalStock}</td>
                      <td><strong>{item.availableStock}</strong></td>
                      <td>{item.reservedStock}</td>
                      <td>{item.lowStockThreshold}</td>
                      <td>
                        {item.isLowStock ? (
                          <span className="badge badge--danger">Low Stock Alert</span>
                        ) : (
                          <span className="badge badge--green">Healthy</span>
                        )}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn btn--dark btn--sm"
                          onClick={() => openAdjustmentModal(item)}
                        >
                          Adjust Stock
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Stock Movement History */}
          <section className="card" aria-labelledby="movements-heading">
            <div className="detail-header">
              <h2 id="movements-heading" className="admin-section-title">
                Stock Movement History &amp; Audit Trail
              </h2>
              <span className="badge badge--outline">Tracks Reason &amp; Administrator</span>
            </div>
            <div className="customer-table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Timestamp</th>
                    <th scope="col">Variant</th>
                    <th scope="col">Movement Type</th>
                    <th scope="col">Delta</th>
                    <th scope="col">Available (Before → After)</th>
                    <th scope="col">Reason / Order Ref</th>
                    <th scope="col">Administrator</th>
                  </tr>
                </thead>
                <tbody>
                  {inventory.movements.map((mov) => (
                    <tr key={mov.id}>
                      <td className="text-small text-secondary">{mov.createdAt}</td>
                      <td>
                        <strong>
                          {mov.productName} · {formatPackSize(mov.packSize)}
                        </strong>
                      </td>
                      <td><span className="badge badge--outline">{mov.movementType}</span></td>
                      <td>
                        <strong
                          style={{
                            color:
                              mov.quantityDelta >= 0 ? 'var(--color-green)' : '#B42318',
                          }}
                        >
                          {mov.quantityDelta >= 0 ? `+${mov.quantityDelta}` : mov.quantityDelta}
                        </strong>
                      </td>
                      <td>
                        {mov.previousAvailable} → <strong>{mov.newAvailable}</strong>
                      </td>
                      <td className="text-small">
                        {mov.reason}{' '}
                        {mov.orderNumber ? <strong>({mov.orderNumber})</strong> : null}
                      </td>
                      <td className="text-small">{mov.actorEmail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {/* Manual Stock Adjustment Drawer */}
      <DetailDrawer
        open={adjustingItem !== null}
        title={
          adjustingItem
            ? `Adjust Stock — ${adjustingItem.productName} (${formatPackSize(adjustingItem.packSize)})`
            : 'Manual Stock Adjustment'
        }
        subtitle="Negative available stock is strictly prohibited. Reason and administrator are logged."
        onClose={() => setAdjustingItem(null)}
      >
        {adjustingItem && (
          <form onSubmit={handleStockAdjustment}>
            {validationError && (
              <Notice tone="error" title="Stock Adjustment Blocked">
                {validationError}
              </Notice>
            )}

            <dl className="admin-kv-grid">
              <div className="admin-kv-item">
                <dt>SKU</dt>
                <dd><code>{adjustingItem.sku}</code></dd>
              </div>
              <div className="admin-kv-item">
                <dt>Current Available Stock</dt>
                <dd>{adjustingItem.availableStock} packs</dd>
              </div>
              <div className="admin-kv-item">
                <dt>Reserved Stock</dt>
                <dd>{adjustingItem.reservedStock} packs</dd>
              </div>
              <div className="admin-kv-item">
                <dt>Total Physical Stock</dt>
                <dd>{adjustingItem.totalStock} packs</dd>
              </div>
            </dl>

            <div className="form-row">
              <div>
                <label htmlFor="adj-type">Adjustment Operation</label>
                <select
                  id="adj-type"
                  className="input"
                  value={adjustmentType}
                  onChange={(e) => setAdjustmentType(e.target.value as 'ADD' | 'DEDUCT')}
                >
                  <option value="ADD">ADD (+ Fresh Batch / Restock)</option>
                  <option value="DEDUCT">DEDUCT (– Damaged / Store Counter Sale)</option>
                </select>
              </div>
              <div>
                <label htmlFor="adj-qty">Quantity (Packs)</label>
                <input
                  id="adj-qty"
                  type="number"
                  min="1"
                  step="1"
                  className="input"
                  value={adjustmentQty}
                  onChange={(e) => setAdjustmentQty(e.target.value)}
                  required
                />
              </div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <label htmlFor="adj-reason">Mandatory Audit Reason</label>
              <textarea
                id="adj-reason"
                className="input"
                placeholder="Explain why stock is being adjusted (e.g. Fresh morning batch packed at University Rd store)…"
                value={adjustmentReason}
                onChange={(e) => setAdjustmentReason(e.target.value)}
                required
              />
            </div>

            <button type="submit" className="btn btn--primary btn--full" disabled={busy}>
              {busy ? 'Recording Adjustment…' : 'Record Stock Adjustment'}
            </button>
          </form>
        )}
      </DetailDrawer>
    </div>
  );
}
