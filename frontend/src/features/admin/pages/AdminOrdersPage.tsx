import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Notice from '../../../components/common/Notice';
import { env } from '../../../lib/env';
import { formatINR, formatPackSize, getErrorMessage } from '../../../lib/api';
import {
  getAdminOrders,
  confirmAdminOrder,
  updateAdminOrderStatus,
} from '../api';
import type {
  AdminOrderDetail,
  AdminOrderStatus,
  AdminPaymentStatus,
} from '../types';
import {
  ORDER_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  getAllowedOrderActions,
  notifyAdminDataChanged,
  validateOrderTransition,
} from '../lib/orderStateMachine';
import {
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

function getOrderProductLabel(order: AdminOrderDetail): string {
  if (order.items.length > 0) {
    return order.items
      .map((item) => `${item.productName} (${item.packSize})`)
      .join(', ');
  }
  return order.itemsSummary;
}

function getOrderTotalQuantity(order: AdminOrderDetail): number {
  return order.items.reduce((sum, item) => sum + item.quantity, 0);
}

export default function AdminOrdersPage() {
  const [searchParams] = useSearchParams();
  const { showToast } = useAdminToast();

  const initialStatusParam = searchParams.get('status') as AdminOrderStatus | null;
  const initialQueryParam = searchParams.get('q') ?? searchParams.get('orderId') ?? '';

  const [orders, setOrders] = useState<AdminOrderDetail[]>([]);
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
      pageSize: 200,
    })
      .then((res) => {
        // One request returns every order with its items, payment details and timeline.
        if (!active) return;
        setOrders(res.items);
        setIsLive(true);
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
    if (nextStatus === 'DELIVERY_FAILED' && actionNotes.trim().length < 5) {
      showToast('Please enter a delivery failure reason (at least 5 characters).', 'warning');
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
              failureReason: nextStatus === 'DELIVERY_FAILED' ? actionNotes.trim() : undefined,
            });
      setOrders((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      setSelectedOrder(updated);
      notifyAdminDataChanged();
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
            Manage customer orders through the verified fulfillment lifecycle.
          </p>
        </div>
      </div>

      {!isLive && (
        <Notice title="Order data unavailable">
          Connect the local FastAPI server to load and manage real orders. No sample orders are shown.
        </Notice>
      )}
      {error && <Notice tone="error" title="Orders request failed">{error}</Notice>}

      {/* Search & Filters */}
      <div className="card card--tinted customer-filters">
        <div style={{ flex: '2 1 240px' }}>
          <label htmlFor="order-search">Search by Order ID, Customer, or Phone</label>
          <input
            id="order-search"
            type="search"
            className="input"
            placeholder="Order ID, customer name, or phone"
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

        <div style={{ flex: '1 1 140px' }}>
          <label htmlFor="order-date-from">From Date</label>
          <input
            id="order-date-from"
            type="date"
            className="input"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
        </div>

        <div style={{ flex: '1 1 140px' }}>
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
          <div
            className="admin-table-wrap"
            role="region"
            aria-label="Customer orders table"
            tabIndex={0}
          >
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Order ID</th>
                  <th scope="col">Customer</th>
                  <th scope="col">Product</th>
                  <th scope="col">Quantity</th>
                  <th scope="col">Total Amount</th>
                  <th scope="col">Payment Status</th>
                  <th scope="col">Order Status</th>
                  <th scope="col">Order Date</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredOrders.map((order) => {
                  const allowedActions = getAllowedOrderActions(
                    order.orderStatus,
                    order.paymentStatus,
                  );
                  const totalQty = getOrderTotalQuantity(order);

                  return (
                    <tr key={order.id}>
                      <td>
                        <strong>{order.orderNumber}</strong>
                      </td>
                      <td>
                        <strong>{order.customerName}</strong>
                        <p className="text-small text-secondary">{order.phone}</p>
                      </td>
                      <td>{getOrderProductLabel(order)}</td>
                      <td>
                        <strong>{totalQty}</strong> {totalQty === 1 ? 'pack' : 'packs'}
                      </td>
                      <td>
                        <strong>{formatINR(order.totalAmount)}</strong>
                      </td>
                      <td>
                        <StatusBadge status={order.paymentStatus} kind="payment" />
                      </td>
                      <td>
                        <StatusBadge status={order.orderStatus} kind="order" />
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
                      <td>
                        <div className="admin-action-group">
                          <button
                            type="button"
                            className="btn btn--outline btn--sm"
                            onClick={() => setSelectedOrder(order)}
                          >
                            View Order
                          </button>
                          {allowedActions.map((act) => (
                            <button
                              key={act.nextStatus}
                              type="button"
                              className={
                                act.tone === 'danger'
                                  ? 'btn btn--danger-outline btn--sm'
                                  : act.tone === 'primary'
                                  ? 'btn btn--primary btn--sm'
                                  : 'btn btn--dark btn--sm'
                              }
                              onClick={() =>
                                initiateOrderTransition(order, act.nextStatus, act.label)
                              }
                            >
                              {act.label}
                            </button>
                          ))}
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
            <div
              className="admin-action-group"
              style={{ width: '100%', justifyContent: 'space-between' }}
            >
              <button
                type="button"
                className="btn btn--outline btn--sm"
                onClick={() => setSelectedOrder(null)}
              >
                Close
              </button>
              <div className="admin-action-group">
                {getAllowedOrderActions(
                  selectedOrder.orderStatus,
                  selectedOrder.paymentStatus,
                ).map((act) => (
                  <button
                    key={act.nextStatus}
                    type="button"
                    className={
                      act.tone === 'danger'
                        ? 'btn btn--danger-outline btn--sm'
                        : act.tone === 'primary'
                        ? 'btn btn--primary btn--sm'
                        : 'btn btn--dark btn--sm'
                    }
                    onClick={() =>
                      initiateOrderTransition(selectedOrder, act.nextStatus, act.label)
                    }
                  >
                    {act.label}
                  </button>
                ))}
              </div>
            </div>
          )
        }
      >
        {selectedOrder && (
          <div>
            {selectedOrder.paymentStatus !== 'VERIFIED' && (
              <Notice tone="warning" title="Payment not verified yet">
                This order cannot be confirmed or packed until an Owner Admin verifies the bank credit in the <Link to="/admin/dashboard">Pending Payment Confirmations</Link> queue.
              </Notice>
            )}

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
                    marginBottom: 12,
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

            <h3 style={{ fontSize: 18, marginBottom: 10 }}>Payment Verification Details</h3>
            <dl className="admin-kv-grid">
              <div className="admin-kv-item">
                <dt>Payment Status</dt>
                <dd><StatusBadge status={selectedOrder.paymentDetails.status} kind="payment" /></dd>
              </div>
              <div className="admin-kv-item">
                <dt>Submitted UTR</dt>
                <dd><code className="admin-utr-code">{selectedOrder.paymentDetails.utrNumber ?? 'Not submitted'}</code></dd>
              </div>
              <div className="admin-kv-item">
                <dt>Bank Credit Reference</dt>
                <dd>{selectedOrder.paymentDetails.bankCreditReference ?? 'Pending verification'}</dd>
              </div>
              <div className="admin-kv-item">
                <dt>Receiving Account</dt>
                <dd>{selectedOrder.paymentDetails.receivingBankAccount ?? 'Official UPI'}</dd>
              </div>
            </dl>

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
            ? `Transition Order ${pendingAction.order.orderNumber} (${pendingAction.order.customerName}) from ${ORDER_STATUS_LABELS[pendingAction.order.orderStatus]} to ${ORDER_STATUS_LABELS[pendingAction.nextStatus]}. Every update is recorded in the backend and reflected in customer order tracking.`
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
              : pendingAction?.nextStatus === 'DELIVERY_FAILED'
              ? 'Delivery Failure Reason (Required)'
              : 'Admin Audit Notes (Optional)'}
          </label>
          <textarea
            id="order-action-notes"
            className="input"
            placeholder={
              pendingAction?.nextStatus === 'CANCELLED'
                ? 'State why this order is being cancelled…'
                : pendingAction?.nextStatus === 'DELIVERY_FAILED'
                ? 'State why delivery could not be completed…'
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
