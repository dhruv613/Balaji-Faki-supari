import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import Notice from '../../../components/common/Notice';
import { env } from '../../../lib/env';
import { getErrorMessage } from '../../../lib/api';
import { getAdminDeliveries, updateAdminDelivery } from '../api';
import type { AdminDeliveryRecord, AdminDeliveryStatus } from '../types';
import { SAMPLE_ADMIN_DELIVERIES } from '../lib/referenceData';
import {
  ORDER_STATUS_LABELS,
  ALLOWED_DELIVERY_TRANSITIONS,
  validateDeliveryTransition,
} from '../lib/orderStateMachine';
import {
  StatCard,
  StatusBadge,
  DetailDrawer,
  AdminTimeline,
  LoadingSkeleton,
  useAdminToast,
} from '../components';

const DELIVERY_STATUS_FILTERS: Array<AdminDeliveryStatus | 'ALL'> = [
  'ALL',
  'CONFIRMED',
  'PACKING',
  'PACKED',
  'PICKED_UP',
  'SHIPPED',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'DELIVERY_FAILED',
];

const NEXT_ACTION_BUTTON_LABEL: Partial<Record<AdminDeliveryStatus, string>> = {
  PACKING: 'Start Packing',
  PACKED: 'Mark Packed',
  PICKED_UP: 'Mark Picked Up',
  SHIPPED: 'Mark Shipped',
  OUT_FOR_DELIVERY: 'Mark Out for Delivery',
  DELIVERED: 'Mark Delivered',
  DELIVERY_FAILED: 'Record Delivery Failure',
};

export default function AdminDeliveryPage() {
  const [searchParams] = useSearchParams();
  const { showToast } = useAdminToast();

  const initialStatus = searchParams.get('status') as AdminDeliveryStatus | null;

  const [deliveries, setDeliveries] = useState<AdminDeliveryRecord[]>(SAMPLE_ADMIN_DELIVERIES);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<AdminDeliveryStatus | 'ALL'>(
    initialStatus && DELIVERY_STATUS_FILTERS.includes(initialStatus) ? initialStatus : 'ALL',
  );
  const [selected, setSelected] = useState<AdminDeliveryRecord | null>(null);

  // Delivery update form fields
  const [assignedPerson, setAssignedPerson] = useState('');
  const [deliveryPhone, setDeliveryPhone] = useState('');
  const [courierRef, setCourierRef] = useState('');
  const [pickupDate, setPickupDate] = useState('');
  const [dispatchDate, setDispatchDate] = useState('');
  const [estimatedDate, setEstimatedDate] = useState('');
  const [deliveredDate, setDeliveredDate] = useState('');
  const [deliveryNotes, setDeliveryNotes] = useState('');
  const [failureReason, setFailureReason] = useState('');
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
    getAdminDeliveries({
      search: query || undefined,
      status: statusFilter,
    })
      .then((res) => {
        if (active) {
          setDeliveries(res.items);
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
  }, [query, statusFilter]);

  function openDeliveryDrawer(record: AdminDeliveryRecord) {
    setSelected(record);
    setAssignedPerson(record.assignedDeliveryPerson ?? '');
    setDeliveryPhone(record.deliveryPhone ?? '');
    setCourierRef(record.courierTrackingReference ?? '');
    setPickupDate(record.pickupDate ?? '');
    setDispatchDate(record.dispatchDate ?? '');
    setEstimatedDate(record.estimatedDeliveryDate ?? '');
    setDeliveredDate(record.deliveredDate ?? '');
    setDeliveryNotes(record.deliveryNotes ?? '');
    setFailureReason(record.failureReason ?? '');
  }

  const filtered = deliveries.filter((d) => {
    if (statusFilter !== 'ALL' && d.status !== statusFilter) return false;
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return `${d.orderNumber} ${d.customerName} ${d.shippingAddress} ${d.contactNumber} ${d.assignedDeliveryPerson ?? ''}`
      .toLowerCase()
      .includes(q);
  });

  async function handleDeliveryStatusTransition(nextStatus: AdminDeliveryStatus) {
    if (!selected) return;

    const check = validateDeliveryTransition(selected.status, nextStatus);
    if (!check.allowed) {
      showToast(check.reason ?? 'Invalid fulfillment transition.', 'error');
      return;
    }

    if (nextStatus === 'DELIVERY_FAILED' && failureReason.trim().length < 5) {
      showToast('Enter a delivery failure reason (at least 5 characters).', 'warning');
      return;
    }

    if (!env.apiBaseUrl) {
      showToast(
        `Integration pending: FastAPI (PATCH /api/admin/deliveries/${selected.id}) is not connected. Fulfillment transition (${ORDER_STATUS_LABELS[selected.status]} → ${ORDER_STATUS_LABELS[nextStatus]}) requires backend persistence.`,
        'warning',
      );
      return;
    }

    setBusy(true);
    try {
      const updated = await updateAdminDelivery(selected.id, {
        status: nextStatus,
        assignedDeliveryPerson: assignedPerson.trim() || undefined,
        deliveryPhone: deliveryPhone.trim() || undefined,
        courierTrackingReference: courierRef.trim() || undefined,
        pickupDate: pickupDate.trim() || undefined,
        dispatchDate: dispatchDate.trim() || undefined,
        estimatedDeliveryDate: estimatedDate.trim() || undefined,
        deliveredDate: deliveredDate.trim() || undefined,
        deliveryNotes: deliveryNotes.trim() || undefined,
        failureReason: nextStatus === 'DELIVERY_FAILED' ? failureReason.trim() : undefined,
      });
      setDeliveries((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      setSelected(updated);
      showToast(
        `Order ${updated.orderNumber} marked ${ORDER_STATUS_LABELS[updated.status]}.`,
        'success',
      );
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  function handleSaveAssignmentDetails(e: FormEvent) {
    e.preventDefault();
    if (!selected) return;
    if (!env.apiBaseUrl) {
      showToast(
        'Integration pending: FastAPI (/api/admin/deliveries) is not connected. Assignment details cannot be saved yet.',
        'warning',
      );
      return;
    }
  }

  return (
    <div className="wrapper">
      <div className="admin-heading">
        <div>
          <h1 className="page__header">Delivery &amp; Fulfillment Management</h1>
          <p className="page__subtitle">
            Manual fulfillment lifecycle control from Confirmed through Packing, Dispatch, and Delivered.
          </p>
        </div>
        <span className="badge badge--outline">Manual Store Fulfillment · No Live GPS</span>
      </div>

      {!isLive && (
        <Notice title="Development reference examples — Fulfillment state machine">
          FastAPI (<code>/api/admin/deliveries</code>) is not connected yet. Only verified and confirmed orders enter this fulfillment queue. Each step validates its required prior state and records an immutable timestamped event for the customer tracking page.
        </Notice>
      )}
      {error && <Notice tone="error" title="Delivery queue sync error">{error}</Notice>}

      <div className="stats-grid--dense">
        <StatCard
          label="Confirmed (Ready)"
          value={deliveries.filter((d) => d.status === 'CONFIRMED').length}
          compact
        />
        <StatCard
          label="Packing"
          value={deliveries.filter((d) => d.status === 'PACKING').length}
          compact
        />
        <StatCard
          label="Packed"
          value={deliveries.filter((d) => d.status === 'PACKED').length}
          compact
        />
        <StatCard
          label="Picked Up / Shipped"
          value={deliveries.filter((d) => ['PICKED_UP', 'SHIPPED'].includes(d.status)).length}
          compact
        />
        <StatCard
          label="Out for Delivery"
          value={deliveries.filter((d) => d.status === 'OUT_FOR_DELIVERY').length}
          compact
        />
        <StatCard
          label="Delivered"
          value={deliveries.filter((d) => d.status === 'DELIVERED').length}
          compact
        />
      </div>

      {/* Search & Status Filters */}
      <div className="card card--tinted customer-filters">
        <div style={{ flex: '2 1 260px' }}>
          <label htmlFor="delivery-search">Search Order, Customer, Address, or Rider</label>
          <input
            id="delivery-search"
            type="search"
            className="input"
            placeholder="#BFP-1042, Rahul Mehta, University Road…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="customer-filter-chips" aria-label="Filter deliveries by status">
          {DELIVERY_STATUS_FILTERS.map((st) => (
            <button
              key={st}
              type="button"
              className={`chip${statusFilter === st ? ' chip--active' : ''}`}
              aria-pressed={statusFilter === st}
              onClick={() => setStatusFilter(st)}
            >
              {st === 'ALL' ? 'All stages' : ORDER_STATUS_LABELS[st]}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <LoadingSkeleton rows={5} />
      ) : (
        <div className="card">
          <div className="customer-table-scroll" role="region" aria-label="Fulfillment queue" tabIndex={0}>
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Order ID</th>
                  <th scope="col">Customer &amp; Contact</th>
                  <th scope="col">Shipping Address</th>
                  <th scope="col">Items</th>
                  <th scope="col">Assigned Delivery Staff</th>
                  <th scope="col">Tracking Ref</th>
                  <th scope="col">Fulfillment Status</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => {
                  const allowedNext = ALLOWED_DELIVERY_TRANSITIONS[item.status] ?? [];
                  const primaryNext = allowedNext[0];
                  return (
                    <tr key={item.id}>
                      <td><strong>{item.orderNumber}</strong></td>
                      <td>
                        <strong>{item.customerName}</strong>
                        <p className="text-small text-secondary">{item.contactNumber}</p>
                      </td>
                      <td className="text-small">
                        {item.shippingAddress} – <strong>{item.pinCode}</strong>
                      </td>
                      <td className="text-small">{item.itemsSummary}</td>
                      <td className="text-small">
                        {item.assignedDeliveryPerson ? (
                          <>
                            <strong>{item.assignedDeliveryPerson}</strong>
                            <p className="text-secondary">{item.deliveryPhone}</p>
                          </>
                        ) : (
                          <span className="text-secondary">Unassigned</span>
                        )}
                      </td>
                      <td className="text-small">
                        {item.courierTrackingReference ? (
                          <code>{item.courierTrackingReference}</code>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td><StatusBadge status={item.status} kind="order" /></td>
                      <td>
                        <div className="admin-action-group">
                          <button
                            type="button"
                            className="text-button"
                            onClick={() => openDeliveryDrawer(item)}
                          >
                            Manage
                          </button>
                          {primaryNext && (
                            <button
                              type="button"
                              className="btn btn--primary btn--sm"
                              onClick={() => openDeliveryDrawer(item)}
                            >
                              {NEXT_ACTION_BUTTON_LABEL[primaryNext] ?? 'Advance'}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={8} className="text-secondary">
                      No fulfillment records match these filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Delivery Lifecycle & History Drawer */}
      <DetailDrawer
        open={selected !== null}
        title={selected ? `Fulfillment — ${selected.orderNumber}` : 'Delivery Details'}
        subtitle={selected ? `${selected.customerName} · ${selected.contactNumber}` : undefined}
        onClose={() => setSelected(null)}
      >
        {selected && (
          <div>
            <dl className="admin-kv-grid">
              <div className="admin-kv-item">
                <dt>Order ID</dt>
                <dd>{selected.orderNumber}</dd>
              </div>
              <div className="admin-kv-item">
                <dt>Current Stage</dt>
                <dd><StatusBadge status={selected.status} kind="order" /></dd>
              </div>
              <div className="admin-kv-item">
                <dt>Items</dt>
                <dd>{selected.itemsSummary}</dd>
              </div>
              <div className="admin-kv-item">
                <dt>Contact Number</dt>
                <dd>{selected.contactNumber}</dd>
              </div>
              <div className="admin-kv-item" style={{ gridColumn: '1 / -1' }}>
                <dt>Shipping Address</dt>
                <dd>
                  {selected.shippingAddress} – PIN {selected.pinCode}
                </dd>
              </div>
            </dl>

            {/* Allowed State Machine Transitions */}
            <section className="card card--tinted" style={{ marginBottom: 20 }}>
              <h3 style={{ fontSize: 18, marginBottom: 6 }}>
                Advance Fulfillment Stage
              </h3>
              <p className="text-small text-secondary" style={{ marginBottom: 12 }}>
                Only valid next transitions from <strong>{ORDER_STATUS_LABELS[selected.status]}</strong> are enabled. Customer tracking updates automatically after backend commit.
              </p>

              <div className="admin-action-group">
                {(ALLOWED_DELIVERY_TRANSITIONS[selected.status] ?? []).map((nextStatus) => (
                  <button
                    key={nextStatus}
                    type="button"
                    className={`btn btn--sm ${
                      nextStatus === 'DELIVERY_FAILED' ? 'btn--outline' : 'btn--primary'
                    }`}
                    style={
                      nextStatus === 'DELIVERY_FAILED'
                        ? { borderColor: '#B42318', color: '#B42318' }
                        : undefined
                    }
                    disabled={busy}
                    onClick={() => handleDeliveryStatusTransition(nextStatus)}
                  >
                    {NEXT_ACTION_BUTTON_LABEL[nextStatus] ?? ORDER_STATUS_LABELS[nextStatus]}
                  </button>
                ))}
                {(ALLOWED_DELIVERY_TRANSITIONS[selected.status] ?? []).length === 0 && (
                  <span className="text-small text-secondary">
                    This order has reached a final delivery state ({ORDER_STATUS_LABELS[selected.status]}).
                  </span>
                )}
              </div>

              {(ALLOWED_DELIVERY_TRANSITIONS[selected.status] ?? []).includes('DELIVERY_FAILED') && (
                <div style={{ marginTop: 14 }}>
                  <label htmlFor="del-failure-reason">
                    Delivery Failure Reason (Required if recording failure)
                  </label>
                  <input
                    id="del-failure-reason"
                    className="input"
                    placeholder="e.g. Customer unavailable at address / phone unreachable"
                    value={failureReason}
                    onChange={(e) => setFailureReason(e.target.value)}
                  />
                </div>
              )}
            </section>

            {/* Delivery Assignment & Dispatch Metadata Form */}
            <form className="card" style={{ marginBottom: 20 }} onSubmit={handleSaveAssignmentDetails}>
              <h3 style={{ fontSize: 18, marginBottom: 12 }}>
                Delivery Staff &amp; Dispatch Details
              </h3>
              <div className="form-row">
                <div>
                  <label htmlFor="del-person">Assigned Delivery Person</label>
                  <input
                    id="del-person"
                    className="input"
                    placeholder="e.g. Bharatbhai Parmar"
                    value={assignedPerson}
                    onChange={(e) => setAssignedPerson(e.target.value)}
                  />
                </div>
                <div>
                  <label htmlFor="del-phone">Delivery Phone</label>
                  <input
                    id="del-phone"
                    className="input"
                    placeholder="+91 98250 XXXXX"
                    value={deliveryPhone}
                    onChange={(e) => setDeliveryPhone(e.target.value)}
                  />
                </div>
              </div>

              <div className="form-row">
                <div>
                  <label htmlFor="del-courier-ref">Courier / Tracking Reference (Optional)</label>
                  <input
                    id="del-courier-ref"
                    className="input"
                    placeholder="Optional local or courier ref"
                    value={courierRef}
                    onChange={(e) => setCourierRef(e.target.value)}
                  />
                </div>
                <div>
                  <label htmlFor="del-est-date">Estimated Delivery Date (Optional)</label>
                  <input
                    id="del-est-date"
                    className="input"
                    placeholder="e.g. 15 Oct 2026"
                    value={estimatedDate}
                    onChange={(e) => setEstimatedDate(e.target.value)}
                  />
                </div>
              </div>

              <div className="form-row">
                <div>
                  <label htmlFor="del-pickup-date">Pickup Date</label>
                  <input
                    id="del-pickup-date"
                    className="input"
                    placeholder="Timestamp of pickup"
                    value={pickupDate}
                    onChange={(e) => setPickupDate(e.target.value)}
                  />
                </div>
                <div>
                  <label htmlFor="del-dispatch-date">Dispatch Date</label>
                  <input
                    id="del-dispatch-date"
                    className="input"
                    placeholder="Timestamp of dispatch"
                    value={dispatchDate}
                    onChange={(e) => setDispatchDate(e.target.value)}
                  />
                </div>
              </div>

              <div style={{ marginBottom: 14 }}>
                <label htmlFor="del-notes">Delivery Notes</label>
                <textarea
                  id="del-notes"
                  className="input"
                  placeholder="Instructions for delivery staff or handover notes…"
                  value={deliveryNotes}
                  onChange={(e) => setDeliveryNotes(e.target.value)}
                />
              </div>

              <button type="submit" className="btn btn--dark btn--sm" disabled={busy}>
                Save Delivery Metadata
              </button>
            </form>

            {/* Immutable Delivery History */}
            <h3 style={{ fontSize: 18, marginBottom: 8 }}>Immutable Delivery Event History</h3>
            <AdminTimeline
              items={selected.history.map((ev) => ({
                id: ev.id,
                label: ev.label,
                timestamp: ev.timestamp,
                description: ev.notes,
                actor: ev.actorName,
              }))}
            />
          </div>
        )}
      </DetailDrawer>
    </div>
  );
}
