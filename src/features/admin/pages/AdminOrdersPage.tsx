import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Notice from '../../../components/common/Notice';
import { env } from '../../../lib/env';
import { formatINR, formatPackSize, getErrorMessage } from '../../../lib/api';
import {
  getAdminOrders,
  getAdminOrderById,
  confirmAdminOrder,
  updateAdminOrderStatus,
} from '../api';
import type {
  AdminOrderDetail,
  AdminOrderStatus,
  AdminPaymentStatus,
} from '../types';
import { SAMPLE_ADMIN_ORDERS } from '../lib/referenceData';
import {
  ORDER_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  validateOrderTransition,
} from '../lib/orderStateMachine';
import {
  StatCard,
  StatusBadge,
  DetailDrawer,
  ConfirmDialog,
  AdminTimeline,
  LoadingSkeleton,
  useAdminToast,
} from '../components';

const ORDER_STATUS_OPTIONS: Array<AdminOrderStatus | 'ALL'> = [
  'ALL',
  'PENDING_PAYMENT',
  'PAYMENT_REVIEW',
  'AWAITING_CONFIRMATION',
  'CONFIRMED',
  'PACKING',
  'PACKED',
  'PICKED_UP',
  'SHIPPED',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'CANCELLED',
  'DELIVERY_FAILED',
];

const PAYMENT_STATUS_OPTIONS: Array<AdminPaymentStatus | 'ALL'> = [
  'ALL',
  'PENDING',
  'SUBMITTED',
  'UNDER_REVIEW',
  'VERIFIED',
  'REJECTED',
];

export function filterAdminOrders(
  orders: AdminOrderDetail[],
  filters: {
    query: string;
    status: AdminOrderStatus | 'ALL';
    paymentStatus: AdminPaymentStatus | 'ALL';
    dateFrom: string;
    dateTo: string;
  },
): AdminOrderDetail[] {
  const q = filters.query.trim().toLowerCase();
  return orders.filter((order) => {
    if (filters.status !== 'ALL' && order.orderStatus !== filters.status) return false;
    if (filters.paymentStatus !== 'ALL' && order.paymentStatus !== filters.paymentStatus) {
      return false;
    }
    if (filters.dateFrom) {
      const fromTs = Date.parse(filters.dateFrom);
      if (Number.isFinite(fromTs) && Date.parse(order.createdAt) < fromTs) return false;
    }
    if (filters.dateTo) {
      const toTs = Date.parse(`${filters.dateTo}T23:59:59`);
      if (Number.isFinite(toTs) && Date.parse(order.createdAt) > toTs) return false;
    }
    if (!q) return true;
    const haystack = `${order.orderNumber} ${order.customerName} ${order.phone} ${order.area} ${order.pinCode}`.toLowerCase();
    return haystack.includes(q);
  });
}

export default function AdminOrdersPage() {
  const [searchParams] = useSearchParams();
  const { showToast } = useAdminToast();

  const initialStatusParam = searchParams.get('status') as AdminOrderStatus | null;
  const initialQueryParam = searchParams.get('q') ?? searchParams.get('orderId') ?? '';

  const [orders, setOrders] = useState<AdminOrderDetail[]>(SAMPLE_ADMIN_ORDERS);
  const [query, setQuery] = useState(initialQueryParam);
  const [statusFilter, setStatusFilter] = useState<AdminOrderStatus | 'ALL'>(
    initialStatusParam && ORDER_STATUS_OPTIONS.includes(initialStatusParam)
      ? initialStatusParam
      : 'ALL',
  );
  const [paymentFilter, setPaymentFilter] = useState<AdminPaymentStatus | 'ALL'>('ALL');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [selectedOrder, setSelectedOrder] = useState<AdminOrderDetail | null>(null);
  const [pendingAction, setPendingAction] = useState<{
    order: AdminOrderDetail;
    nextStatus: AdminOrderStatus;
    label: string;
  } | null>(null);
  const [actionNotes, setActionNotes] = useState('');
  const [actionBusy, setActionBusy] = useState(false);

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
    getAdminOrders({
      search: query || undefined,
      status: statusFilter,
      paymentStatus: paymentFilter,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
    })
      .then(async (res) => {
        if (!active) return;
        const detailed = await Promise.all(
          res.items.map((item) => getAdminOrderById(item.id).catch(() => null)),
        );
        if (active) {
          setOrders(detailed.filter((item): item is AdminOrderDetail => item !== null));
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
  }, [query, statusFilter, paymentFilter, dateFrom, dateTo]);

  const filteredOrders = filterAdminOrders(orders, {
    query,
    status: statusFilter,
    paymentStatus: paymentFilter,
    dateFrom,
    dateTo,
  });

  function initiateOrderTransition(
    order: AdminOrderDetail,
    nextStatus: AdminOrderStatus,
    label: string,
  ) {
    const check = validateOrderTransition({
      currentStatus: order.orderStatus,
      nextStatus,
      paymentStatus: order.paymentStatus,
    });
    if (!check.allowed) {
      showToast(check.reason ?? 'Transition is not allowed.', 'error');
      return;
    }
    setActionNotes('');
    setPendingAction({ order, nextStatus, label });
  }

  async function executeOrderAction() {
    if (!pendingAction) return;
    const { order, nextStatus } = pendingAction;

    // Double-check state machine rules before calling API
    const check = validateOrderTransition({
      currentStatus: order.orderStatus,
      nextStatus,
      paymentStatus: order.paymentStatus,
    });
    if (!check.allowed) {
      showToast(check.reason ?? 'Invalid state transition.', 'error');
      setPendingAction(null);
      return;
    }

    if (nextStatus === 'CANCELLED' && actionNotes.trim().length < 5) {
      showToast('Please enter a cancellation reason (at least 5 characters).', 'warning');
      return;
    }

    if (!env.apiBaseUrl) {
      showToast(
        'Integration pending: FastAPI (/api/admin/orders) is not connected. Order status changes require backend transaction & audit logging.',
        'warning',
      );
      setPendingAction(null);
      return;
    }

    setActionBusy(true);
    try {
      const updated =
        nextStatus === 'CONFIRMED'
          ? await confirmAdminOrder(order.id, { notes: actionNotes.trim() || undefined })
          : await updateAdminOrderStatus(order.id, {
              status: nextStatus,
              notes: actionNotes.trim() || undefined,
              cancellationReason: nextStatus === 'CANCELLED' ? actionNotes.trim() : undefined,
            });
      setOrders((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      setSelectedOrder(updated);
      showToast(
        `Order ${updated.orderNumber} updated to ${ORDER_STATUS_LABELS[updated.orderStatus]}.`,
        'success',
      );
      setPendingAction(null);
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    } finally {
      setActionBusy(false);
    }
  }

  return (
    <div className="wrapper">
      <div className="admin-heading">
        <div>
          <h1 className="page__header">Order Management</h1>
          <p className="page__subtitle">
            Track, confirm, pack, and manage customer Faki &amp; Supari orders.
          </p>
        </div>
        <div className="admin-action-group">
          <Link to="/admin/payments" className="btn btn--outline btn--sm">
            Payment Verification Queue
          </Link>
          <Link to="/admin/delivery" className="btn btn--dark btn--sm">
            Delivery Lifecycle
          </Link>
        </div>
      </div>

      {!isLive && (
        <Notice title="Development reference examples — State machine active">
          FastAPI (<code>GET /api/admin/orders</code>) is not connected yet. The orders below are reference examples demonstrating the strict separation between payment verification and order confirmation. No fake order confirmations are persisted without the backend.
        </Notice>
      )}
      {error && <Notice tone="error" title="Orders request failed">{error}</Notice>}

      <div className="stats-grid">
        <StatCard label="Total Orders" value={orders.length} />
        <StatCard
          label="Awaiting Confirmation"
          value={orders.filter((o) => o.orderStatus === 'AWAITING_CONFIRMATION').length}
          subtitle="Payment verified"
        />
        <StatCard
          label="In Fulfillment"
          value={
            orders.filter((o) =>
              ['CONFIRMED', 'PACKING', 'PACKED', 'PICKED_UP', 'SHIPPED', 'OUT_FOR_DELIVERY'].includes(
                o.orderStatus,
              ),
            ).length
          }
          subtitle="Confirmed → Out for delivery"
        />
        <StatCard
          label="Delivered"
          value={orders.filter((o) => o.orderStatus === 'DELIVERED').length}
        />
      </div>

      {/* Search & Filters */}
      <div className="card card--tinted customer-filters">
        <div style={{ flex: '2 1 260px' }}>
          <label htmlFor="order-search">Search by Order ID, Customer, or Phone</label>
          <input
            id="order-search"
            type="search"
            className="input"
            placeholder="#BFP-1042, Rahul Mehta, or +91 98XXX…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div style={{ flex: '1 1 180px' }}>
          <label htmlFor="order-status-filter">Order Status</label>
          <select
            id="order-status-filter"
            className="input"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as AdminOrderStatus | 'ALL')}
          >
            {ORDER_STATUS_OPTIONS.map((st) => (
              <option key={st} value={st}>
                {st === 'ALL' ? 'All order statuses' : ORDER_STATUS_LABELS[st]}
              </option>
            ))}
          </select>
        </div>

        <div style={{ flex: '1 1 170px' }}>
          <label htmlFor="payment-status-filter">Payment Status</label>
          <select
            id="payment-status-filter"
            className="input"
            value={paymentFilter}
            onChange={(e) => setPaymentFilter(e.target.value as AdminPaymentStatus | 'ALL')}
          >
            {PAYMENT_STATUS_OPTIONS.map((pst) => (
              <option key={pst} value={pst}>
                {pst === 'ALL' ? 'All payment statuses' : PAYMENT_STATUS_LABELS[pst]}
              </option>
            ))}
          </select>
        </div>

        <div style={{ flex: '1 1 145px' }}>
          <label htmlFor="order-date-from">From Date</label>
          <input
            id="order-date-from"
            type="date"
            className="input"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
        </div>

        <div style={{ flex: '1 1 145px' }}>
          <label htmlFor="order-date-to">To Date</label>
          <input
            id="order-date-to"
            type="date"
            className="input"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
          />
        </div>
      </div>

      {loading ? (
        <LoadingSkeleton rows={5} />
      ) : (
        <div className="card">
          <div className="customer-table-scroll" role="region" aria-label="All orders table" tabIndex={0}>
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Order ID</th>
                  <th scope="col">Date &amp; Time</th>
                  <th scope="col">Customer</th>
                  <th scope="col">Phone</th>
                  <th scope="col">Items</th>
                  <th scope="col">Order Amount</th>
                  <th scope="col">Payment Status</th>
                  <th scope="col">Order Status</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredOrders.map((order) => {
                  const canConfirm = validateOrderTransition({
                    currentStatus: order.orderStatus,
                    nextStatus: 'CONFIRMED',
                    paymentStatus: order.paymentStatus,
                  }).allowed;
                  const canStartPacking = validateOrderTransition({
                    currentStatus: order.orderStatus,
                    nextStatus: 'PACKING',
                    paymentStatus: order.paymentStatus,
                  }).allowed;
                  const canMarkPacked = validateOrderTransition({
                    currentStatus: order.orderStatus,
                    nextStatus: 'PACKED',
                    paymentStatus: order.paymentStatus,
                  }).allowed;

                  return (
                    <tr key={order.id}>
                      <td>
                        <strong>{order.orderNumber}</strong>
                        <p className="text-small text-secondary">{order.area}</p>
                      </td>
                      <td className="text-small">
                        {new Date(order.createdAt).toLocaleString('en-IN', {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>
                      <td><strong>{order.customerName}</strong></td>
                      <td>{order.phone}</td>
                      <td>{order.itemsSummary}</td>
                      <td><strong>{formatINR(order.totalAmount)}</strong></td>
                      <td><StatusBadge status={order.paymentStatus} kind="payment" /></td>
                      <td><StatusBadge status={order.orderStatus} kind="order" /></td>
                      <td>
                        <div className="admin-action-group">
                          <button
                            type="button"
                            className="text-button"
                            onClick={() => setSelectedOrder(order)}
                          >
                            Details
                          </button>
                          {canConfirm && (
                            <button
                              type="button"
                              className="btn btn--primary btn--sm"
                              onClick={() =>
                                initiateOrderTransition(order, 'CONFIRMED', 'Confirm Order')
                              }
                            >
                              Confirm
                            </button>
                          )}
                          {canStartPacking && (
                            <button
                              type="button"
                              className="btn btn--dark btn--sm"
                              onClick={() =>
                                initiateOrderTransition(order, 'PACKING', 'Start Packing')
                              }
                            >
                              Start Packing
                            </button>
                          )}
                          {canMarkPacked && (
                            <button
                              type="button"
                              className="btn btn--dark btn--sm"
                              onClick={() =>
                                initiateOrderTransition(order, 'PACKED', 'Mark Packed')
                              }
                            >
                              Mark Packed
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filteredOrders.length === 0 && (
                  <tr>
                    <td colSpan={9} className="text-secondary">
                      No orders match the current search and status filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="pagination">
            <span className="pagination__info" role="status">
              Showing {filteredOrders.length ? `1–${filteredOrders.length}` : '0'} of{' '}
              {filteredOrders.length} matching orders
            </span>
            <div className="customer-filter-chips">
              <button type="button" className="btn btn--sm" disabled>
                Previous
              </button>
              <button type="button" className="btn btn--sm" disabled>
                Next
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Order Details Drawer */}
      <DetailDrawer
        open={selectedOrder !== null}
        title={selectedOrder ? `Order ${selectedOrder.orderNumber}` : 'Order Details'}
        subtitle={
          selectedOrder
            ? `Placed on ${new Date(selectedOrder.createdAt).toLocaleString('en-IN')}`
            : undefined
        }
        onClose={() => setSelectedOrder(null)}
        footer={
          selectedOrder && (
            <div className="admin-action-group" style={{ width: '100%', justifyContent: 'space-between' }}>
              <div>
                {selectedOrder.orderStatus !== 'CANCELLED' &&
                  selectedOrder.orderStatus !== 'DELIVERED' && (
                    <button
                      type="button"
                      className="btn btn--outline btn--sm"
                      style={{ borderColor: '#B42318', color: '#B42318' }}
                      onClick={() =>
                        initiateOrderTransition(selectedOrder, 'CANCELLED', 'Cancel Order')
                      }
                    >
                      Cancel Order
                    </button>
                  )}
              </div>
              <div className="admin-action-group">
                <button
                  type="button"
                  className="btn btn--primary btn--sm"
                  disabled={
                    !validateOrderTransition({
                      currentStatus: selectedOrder.orderStatus,
                      nextStatus: 'CONFIRMED',
                      paymentStatus: selectedOrder.paymentStatus,
                    }).allowed
                  }
                  title={
                    selectedOrder.paymentStatus !== 'VERIFIED'
                      ? 'Payment must be VERIFIED before order confirmation'
                      : undefined
                  }
                  onClick={() =>
                    initiateOrderTransition(selectedOrder, 'CONFIRMED', 'Confirm Order')
                  }
                >
                  Confirm Order
                </button>
                <button
                  type="button"
                  className="btn btn--dark btn--sm"
                  disabled={
                    !validateOrderTransition({
                      currentStatus: selectedOrder.orderStatus,
                      nextStatus: 'PACKING',
                      paymentStatus: selectedOrder.paymentStatus,
                    }).allowed
                  }
                  title={
                    selectedOrder.orderStatus !== 'CONFIRMED'
                      ? 'Order must be CONFIRMED before packing begins'
                      : undefined
                  }
                  onClick={() =>
                    initiateOrderTransition(selectedOrder, 'PACKING', 'Start Packing')
                  }
                >
                  Start Packing
                </button>
                <button
                  type="button"
                  className="btn btn--dark btn--sm"
                  disabled={
                    !validateOrderTransition({
                      currentStatus: selectedOrder.orderStatus,
                      nextStatus: 'PACKED',
                      paymentStatus: selectedOrder.paymentStatus,
                    }).allowed
                  }
                  onClick={() =>
                    initiateOrderTransition(selectedOrder, 'PACKED', 'Mark Packed')
                  }
                >
                  Mark Packed
                </button>
              </div>
            </div>
          )
        }
      >
        {selectedOrder && (
          <div>
            {/* State Machine Policy Notice if Unverified */}
            {selectedOrder.paymentStatus !== 'VERIFIED' && (
              <Notice tone="warning" title="Payment not verified yet">
                This order cannot be confirmed or packed until an Owner Admin independently verifies the bank credit in the <Link to="/admin/payments">Manual Payment Verification</Link> module.
              </Notice>
            )}

            {/* Customer & Delivery Information */}
            <h3 style={{ fontSize: 18, marginBottom: 10 }}>Customer &amp; Delivery Address</h3>
            <dl className="admin-kv-grid">
              <div className="admin-kv-item">
                <dt>Customer Name</dt>
                <dd>{selectedOrder.customerName}</dd>
              </div>
              <div className="admin-kv-item">
                <dt>Phone</dt>
                <dd>{selectedOrder.phone}</dd>
              </div>
              <div className="admin-kv-item">
                <dt>Email</dt>
                <dd>{selectedOrder.customerEmail ?? 'Not provided'}</dd>
              </div>
              <div className="admin-kv-item">
                <dt>PIN Code</dt>
                <dd>{selectedOrder.pinCode}</dd>
              </div>
              <div className="admin-kv-item" style={{ gridColumn: '1 / -1' }}>
                <dt>Complete Address</dt>
                <dd>{selectedOrder.address}</dd>
              </div>
              {selectedOrder.customerNotes && (
                <div className="admin-kv-item" style={{ gridColumn: '1 / -1' }}>
                  <dt>Customer Notes</dt>
                  <dd>{selectedOrder.customerNotes}</dd>
                </div>
              )}
            </dl>

            {/* Line Items with Product Images */}
            <h3 style={{ fontSize: 18, marginBottom: 10 }}>Ordered Items</h3>
            <div className="card" style={{ padding: 16, marginBottom: 20 }}>
              {selectedOrder.items.map((item) => (
                <div
                  key={item.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 16,
                    paddingBottom: 12,
                    borderBottom: '1px solid var(--color-border)',
                  }}
                >
                  <img
                    src={item.productImage}
                    alt={item.productName}
                    style={{
                      width: 64,
                      height: 64,
                      objectFit: 'cover',
                      borderRadius: 10,
                      border: '1px solid var(--color-border)',
                    }}
                  />
                  <div style={{ flex: 1 }}>
                    <strong>
                      {item.productName} (<span lang="gu">{item.productNameGu}</span>)
                    </strong>
                    <p className="text-small text-secondary">
                      Pack Size: {formatPackSize(item.packSize)} · Quantity: {item.quantity}
                    </p>
                    <p className="text-small text-secondary">
                      Unit Price: {formatINR(item.unitPrice)}
                    </p>
                  </div>
                  <strong>{formatINR(item.lineTotal)}</strong>
                </div>
              ))}
              <div className="summary-row" style={{ marginTop: 8 }}>
                <span>Subtotal</span>
                <strong>{formatINR(selectedOrder.subtotal)}</strong>
              </div>
              <div className="summary-row">
                <span>Delivery Charges</span>
                <strong>{formatINR(selectedOrder.deliveryCharges)}</strong>
              </div>
              <div className="summary-row">
                <span>Total Amount</span>
                <strong>{formatINR(selectedOrder.totalAmount)}</strong>
              </div>
            </div>

            {/* Payment Details */}
            <h3 style={{ fontSize: 18, marginBottom: 10 }}>Payment Verification Details</h3>
            <dl className="admin-kv-grid">
              <div className="admin-kv-item">
                <dt>Payment Status</dt>
                <dd><StatusBadge status={selectedOrder.paymentDetails.status} kind="payment" /></dd>
              </div>
              <div className="admin-kv-item">
                <dt>Submitted UTR</dt>
                <dd><code>{selectedOrder.paymentDetails.utrNumber ?? 'Not submitted'}</code></dd>
              </div>
              <div className="admin-kv-item">
                <dt>Bank Credit Reference</dt>
                <dd>{selectedOrder.paymentDetails.bankCreditReference ?? 'Pending verification'}</dd>
              </div>
              <div className="admin-kv-item">
                <dt>Receiving Account</dt>
                <dd>{selectedOrder.paymentDetails.receivingBankAccount ?? 'Official UPI'}</dd>
              </div>
              {selectedOrder.paymentDetails.verifiedBy && (
                <div className="admin-kv-item">
                  <dt>Verified By</dt>
                  <dd>
                    {selectedOrder.paymentDetails.verifiedBy} ({selectedOrder.paymentDetails.verifiedAt})
                  </dd>
                </div>
              )}
            </dl>

            {/* Order History Timeline */}
            <h3 style={{ fontSize: 18, marginBottom: 10 }}>Immutable Order Timeline</h3>
            <AdminTimeline
              items={selectedOrder.timeline.map((ev) => ({
                id: ev.id,
                label: ev.label,
                timestamp: ev.timestamp,
                description: ev.description,
                actor: `${ev.actorName} (${ev.actorRole})`,
              }))}
            />
          </div>
        )}
      </DetailDrawer>

      {/* Confirmation Dialog for Order Actions */}
      <ConfirmDialog
        open={pendingAction !== null}
        title={pendingAction ? `${pendingAction.label} — ${pendingAction.order.orderNumber}` : ''}
        description={
          pendingAction
            ? `Transition Order ${pendingAction.order.orderNumber} (${pendingAction.order.customerName}) from ${ORDER_STATUS_LABELS[pendingAction.order.orderStatus]} to ${ORDER_STATUS_LABELS[pendingAction.nextStatus]}. Every update is recorded with your admin identity and timestamp.`
            : ''
        }
        confirmLabel={pendingAction?.label ?? 'Confirm'}
        tone={pendingAction?.nextStatus === 'CANCELLED' ? 'danger' : 'primary'}
        busy={actionBusy}
        onConfirm={executeOrderAction}
        onCancel={() => setPendingAction(null)}
      >
        <div style={{ marginTop: 12 }}>
          <label htmlFor="order-action-notes">
            {pendingAction?.nextStatus === 'CANCELLED'
              ? 'Cancellation Reason (Required)'
              : 'Admin Audit Notes (Optional)'}
          </label>
          <textarea
            id="order-action-notes"
            className="input"
            placeholder={
              pendingAction?.nextStatus === 'CANCELLED'
                ? 'State why this order is being cancelled…'
                : 'Add optional fulfillment or audit note…'
            }
            value={actionNotes}
            onChange={(e) => setActionNotes(e.target.value)}
          />
        </div>
      </ConfirmDialog>
    </div>
  );
}
