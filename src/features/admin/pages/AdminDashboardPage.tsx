import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Notice from '../../../components/common/Notice';
import { env } from '../../../lib/env';
import { formatINR, getErrorMessage } from '../../../lib/api';
import { getAdminDashboard } from '../api';
import type { AdminDashboardResponse } from '../types';
import {
  SAMPLE_ADMIN_ORDER_SUMMARIES,
  SAMPLE_ADMIN_PAYMENTS,
  SAMPLE_AUDIT_LOGS,
  SAMPLE_ADMIN_INVENTORY,
  SAMPLE_ADMIN_REFUNDS,
} from '../lib/referenceData';
import { ORDER_STATUS_LABELS } from '../lib/orderStateMachine';
import { StatCard, StatusBadge, LoadingSkeleton } from '../components';

function buildReferenceDashboard(): AdminDashboardResponse {
  const orders = SAMPLE_ADMIN_ORDER_SUMMARIES;
  const payments = SAMPLE_ADMIN_PAYMENTS;
  return {
    metrics: {
      totalOrders: orders.length,
      todaysOrders: 2,
      verifiedPaymentReceiptsCount: payments.filter((p) => p.paymentStatus === 'VERIFIED').length,
      verifiedPaymentReceiptsAmount: 0,
      pendingPaymentsCount: payments.filter((p) =>
        ['PENDING', 'SUBMITTED', 'UNDER_REVIEW'].includes(p.paymentStatus),
      ).length,
      ordersAwaitingConfirmation: orders.filter((o) => o.orderStatus === 'AWAITING_CONFIRMATION').length,
      packingOrders: orders.filter((o) => o.orderStatus === 'PACKING').length,
      packedOrders: orders.filter((o) => o.orderStatus === 'PACKED').length,
      outForDeliveryOrders: orders.filter((o) => o.orderStatus === 'OUT_FOR_DELIVERY').length,
      deliveredOrdersCount: orders.filter((o) => o.orderStatus === 'DELIVERED').length,
      deliveredOrderSalesAmount: 0,
      pendingRefundsCount: SAMPLE_ADMIN_REFUNDS.filter((r) => r.refundStatus === 'PENDING').length,
      completedRefundsAmount: 0,
      lowStockProductsCount: SAMPLE_ADMIN_INVENTORY.summary.lowStockAlertsCount,
    },
    recentOrders: orders.slice(0, 5),
    recentPayments: payments.slice(0, 4),
    salesOverview: [
      { date: '2026-10-11', label: '11 Oct', deliveredSalesAmount: 0, verifiedReceiptsAmount: 0, refundedAmount: 0, orderCount: 1 },
      { date: '2026-10-12', label: '12 Oct', deliveredSalesAmount: 0, verifiedReceiptsAmount: 0, refundedAmount: 0, orderCount: 2 },
      { date: '2026-10-13', label: '13 Oct', deliveredSalesAmount: 0, verifiedReceiptsAmount: 0, refundedAmount: 0, orderCount: 1 },
      { date: '2026-10-14', label: '14 Oct', deliveredSalesAmount: 0, verifiedReceiptsAmount: 0, refundedAmount: 0, orderCount: 2 },
      { date: '2026-10-15', label: '15 Oct', deliveredSalesAmount: 0, verifiedReceiptsAmount: 0, refundedAmount: 0, orderCount: 2 },
    ],
    statusDistribution: [
      { status: 'PAYMENT_REVIEW', count: 1 },
      { status: 'AWAITING_CONFIRMATION', count: 1 },
      { status: 'CONFIRMED', count: 1 },
      { status: 'OUT_FOR_DELIVERY', count: 1 },
      { status: 'DELIVERED', count: 1 },
    ],
    recentActivity: SAMPLE_AUDIT_LOGS,
    ordersRequiringAttention: orders.filter((o) =>
      ['PAYMENT_REVIEW', 'AWAITING_CONFIRMATION', 'CONFIRMED'].includes(o.orderStatus),
    ),
  };
}

export default function AdminDashboardPage() {
  const [data, setData] = useState<AdminDashboardResponse>(() => buildReferenceDashboard());
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
    getAdminDashboard()
      .then((res) => {
        if (active) {
          setData(res);
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

  const { metrics } = data;
  const maxOrderDay = Math.max(1, ...data.salesOverview.map((d) => d.orderCount));

  return (
    <div className="wrapper">
      <div className="admin-heading">
        <div>
          <h1 className="page__header">Operational Dashboard</h1>
          <p className="page__subtitle">
            Store overview, manual payment verification queue, and fulfillment status.
          </p>
        </div>
        <div className="admin-action-group">
          <Link to="/admin/payments" className="btn btn--primary btn--sm">
            Verify Payments ({metrics.pendingPaymentsCount})
          </Link>
          <Link to="/admin/orders" className="btn btn--dark btn--sm">
            Manage Orders
          </Link>
        </div>
      </div>

      {!isLive && (
        <Notice title="Backend integration pending — Reference overview">
          FastAPI (<code>GET /api/admin/dashboard</code>) is not connected yet. Figures below reflect the supplied design reference examples. Unverified payment submissions are strictly excluded from revenue, and product prices show <strong>Awaiting price</strong> until configured on the server.
        </Notice>
      )}
      {error && <Notice tone="error" title="Dashboard sync failed">{error}</Notice>}

      {loading ? (
        <LoadingSkeleton rows={6} />
      ) : (
        <>
          {/* Financial Distinction Banner & Ledger Breakdown */}
          <section className="card card--tinted" style={{ marginBottom: 24 }} aria-labelledby="financial-distinction-heading">
            <div className="detail-header">
              <h2 id="financial-distinction-heading" style={{ fontSize: 22 }}>
                Financial Accounting Separation
              </h2>
              <span className="badge badge--dark">Unverified proofs excluded</span>
            </div>
            <p className="text-small text-secondary" style={{ marginBottom: 16 }}>
              Customer-uploaded screenshots or UTRs never count toward receipts or sales until an Owner Admin independently verifies the bank credit.
            </p>
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
              <div className="card" style={{ padding: 16 }}>
                <div className="text-small text-secondary">1. Verified Payment Receipts</div>
                <div className="stat-card__value stat-card__value--sm" style={{ marginTop: 4 }}>
                  {isLive ? formatINR(metrics.verifiedPaymentReceiptsAmount) : 'Awaiting price'}
                </div>
                <p className="text-small text-secondary" style={{ marginTop: 6 }}>
                  {metrics.verifiedPaymentReceiptsCount} bank-verified UPI credits
                </p>
              </div>
              <div className="card" style={{ padding: 16 }}>
                <div className="text-small text-secondary">2. Delivered-Order Sales</div>
                <div className="stat-card__value stat-card__value--sm" style={{ marginTop: 4, color: 'var(--color-green)' }}>
                  {isLive ? formatINR(metrics.deliveredOrderSalesAmount) : 'Awaiting price'}
                </div>
                <p className="text-small text-secondary" style={{ marginTop: 6 }}>
                  {metrics.deliveredOrdersCount} completed & delivered orders
                </p>
              </div>
              <div className="card" style={{ padding: 16 }}>
                <div className="text-small text-secondary">3. Completed Refunds</div>
                <div className="stat-card__value stat-card__value--sm" style={{ marginTop: 4, color: 'var(--color-primary-dark)' }}>
                  {isLive ? formatINR(metrics.completedRefundsAmount) : 'Awaiting price'}
                </div>
                <p className="text-small text-secondary" style={{ marginTop: 6 }}>
                  Separate bank-verified refund transfers
                </p>
              </div>
            </div>
          </section>

          {/* 11 Required Summary Cards — Every card links to the relevant filtered page */}
          <section aria-label="Operational summary metrics">
            <div className="stats-grid--dense">
              <StatCard
                label="Total Orders"
                value={metrics.totalOrders}
                subtitle="All recorded orders"
                to="/admin/orders"
              />
              <StatCard
                label="Today's Orders"
                value={metrics.todaysOrders}
                subtitle="Placed today"
                to="/admin/orders?date=today"
              />
              <StatCard
                label="Verified Payment Receipts"
                value={metrics.verifiedPaymentReceiptsCount}
                subtitle="Bank credit matched"
                to="/admin/payments?status=VERIFIED"
              />
              <StatCard
                label="Pending Payments"
                value={metrics.pendingPaymentsCount}
                subtitle="Awaiting bank check"
                to="/admin/payments?status=SUBMITTED"
              />
              <StatCard
                label="Orders Awaiting Confirmation"
                value={metrics.ordersAwaitingConfirmation}
                subtitle="Paid · Needs confirm"
                to="/admin/orders?status=AWAITING_CONFIRMATION"
              />
              <StatCard
                label="Packing Orders"
                value={metrics.packingOrders}
                subtitle="In preparation"
                to="/admin/delivery?status=PACKING"
              />
              <StatCard
                label="Packed Orders"
                value={metrics.packedOrders}
                subtitle="Ready for pickup"
                to="/admin/delivery?status=PACKED"
              />
              <StatCard
                label="Out for Delivery"
                value={metrics.outForDeliveryOrders}
                subtitle="With delivery staff"
                to="/admin/delivery?status=OUT_FOR_DELIVERY"
              />
              <StatCard
                label="Delivered Orders"
                value={metrics.deliveredOrdersCount}
                subtitle="Fulfilled orders"
                to="/admin/orders?status=DELIVERED"
              />
              <StatCard
                label="Pending Refunds"
                value={metrics.pendingRefundsCount}
                subtitle="Requires transfer check"
                to="/admin/refunds?status=PENDING"
              />
              <StatCard
                label="Low Stock Products"
                value={metrics.lowStockProductsCount}
                subtitle="Below threshold"
                to="/admin/inventory?filter=low_stock"
              />
            </div>
          </section>

          {/* Orders Requiring Attention */}
          <section className="card" style={{ marginBottom: 24 }} aria-labelledby="attention-heading">
            <div className="detail-header">
              <div>
                <h2 id="attention-heading" className="admin-section-title" style={{ marginBottom: 2 }}>
                  Orders Requiring Immediate Attention
                </h2>
                <p className="text-small text-secondary">
                  Orders awaiting manual bank payment verification, order confirmation, or packing start.
                </p>
              </div>
              <Link to="/admin/orders" className="btn btn--outline btn--sm">
                View all orders
              </Link>
            </div>
            <div className="customer-table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Order ID</th>
                    <th scope="col">Customer</th>
                    <th scope="col">Items</th>
                    <th scope="col">Payment Status</th>
                    <th scope="col">Order Status</th>
                    <th scope="col">Required Next Step</th>
                    <th scope="col">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {data.ordersRequiringAttention.map((order) => (
                    <tr key={order.id}>
                      <td><strong>{order.orderNumber}</strong></td>
                      <td>{order.customerName}</td>
                      <td>{order.itemsSummary}</td>
                      <td><StatusBadge status={order.paymentStatus} kind="payment" /></td>
                      <td><StatusBadge status={order.orderStatus} kind="order" /></td>
                      <td className="text-small">
                        {order.paymentStatus !== 'VERIFIED'
                          ? '1. Verify bank credit in Payments'
                          : order.orderStatus === 'AWAITING_CONFIRMATION'
                          ? '2. Confirm order & validate stock'
                          : '3. Start packing in Delivery'}
                      </td>
                      <td>
                        {order.paymentStatus !== 'VERIFIED' ? (
                          <Link to="/admin/payments" className="text-button">
                            Verify payment
                          </Link>
                        ) : (
                          <Link to={`/admin/orders?orderId=${encodeURIComponent(order.orderNumber)}`} className="text-button">
                            Manage order
                          </Link>
                        )}
                      </td>
                    </tr>
                  ))}
                  {data.ordersRequiringAttention.length === 0 && (
                    <tr>
                      <td colSpan={7} className="text-secondary">
                        No orders currently awaiting verification or confirmation.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Recent Orders & Recent Payment Submissions */}
          <div className="admin-two-col">
            <section className="card" aria-labelledby="recent-orders-heading">
              <div className="detail-header">
                <h2 id="recent-orders-heading" className="admin-section-title">
                  Recent Orders
                </h2>
                <Link to="/admin/orders" className="text-button">
                  All orders →
                </Link>
              </div>
              <div className="customer-table-scroll">
                <table className="data-table" style={{ minWidth: 500 }}>
                  <thead>
                    <tr>
                      <th scope="col">Order</th>
                      <th scope="col">Customer</th>
                      <th scope="col">Items</th>
                      <th scope="col">Payment</th>
                      <th scope="col">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recentOrders.map((order) => (
                      <tr key={order.id}>
                        <td>
                          <Link to={`/admin/orders?orderId=${encodeURIComponent(order.orderNumber)}`}>
                            <strong>{order.orderNumber}</strong>
                          </Link>
                        </td>
                        <td>{order.customerName}</td>
                        <td className="text-small">{order.itemsSummary}</td>
                        <td><StatusBadge status={order.paymentStatus} kind="payment" /></td>
                        <td><StatusBadge status={order.orderStatus} kind="order" /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="card" aria-labelledby="recent-payments-heading">
              <div className="detail-header">
                <h2 id="recent-payments-heading" className="admin-section-title">
                  Recent Payment Submissions
                </h2>
                <Link to="/admin/payments" className="text-button">
                  Payment queue →
                </Link>
              </div>
              <div className="customer-table-scroll">
                <table className="data-table" style={{ minWidth: 500 }}>
                  <thead>
                    <tr>
                      <th scope="col">Order</th>
                      <th scope="col">Customer</th>
                      <th scope="col">Submitted UTR</th>
                      <th scope="col">Status</th>
                      <th scope="col">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recentPayments.map((pay) => (
                      <tr key={pay.id}>
                        <td><strong>{pay.orderNumber}</strong></td>
                        <td>{pay.customerName}</td>
                        <td><code>{pay.submittedUtr}</code></td>
                        <td><StatusBadge status={pay.paymentStatus} kind="payment" /></td>
                        <td>
                          <Link to={`/admin/payments?order=${encodeURIComponent(pay.orderNumber)}`} className="text-button">
                            Inspect
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>

          {/* Sales Overview Chart & Order Status Distribution */}
          <div className="admin-two-col">
            <section className="card" aria-labelledby="sales-chart-heading">
              <div className="detail-header">
                <h2 id="sales-chart-heading" className="admin-section-title">
                  Sales & Order Volume Overview
                </h2>
                <Link to="/admin/reports" className="text-button">
                  Full reports →
                </Link>
              </div>
              <p className="text-small text-secondary">
                Daily verified order activity (unverified screenshot submissions excluded).
              </p>
              <div className="admin-bar-chart">
                {data.salesOverview.map((point) => (
                  <div className="admin-bar-row" key={point.date}>
                    <span>{point.label}</span>
                    <div className="admin-bar-track">
                      <div
                        className="admin-bar-fill"
                        style={{ width: `${Math.round((point.orderCount / maxOrderDay) * 100)}%` }}
                      />
                    </div>
                    <strong style={{ textAlign: 'right' }}>{point.orderCount} orders</strong>
                  </div>
                ))}
              </div>
            </section>

            <section className="card" aria-labelledby="status-dist-heading">
              <div className="detail-header">
                <h2 id="status-dist-heading" className="admin-section-title">
                  Order Status Distribution
                </h2>
                <Link to="/admin/delivery" className="text-button">
                  Fulfillment →
                </Link>
              </div>
              <p className="text-small text-secondary">
                Breakdown of orders across the state machine lifecycle.
              </p>
              <div className="admin-bar-chart">
                {data.statusDistribution.map((item) => (
                  <div className="admin-bar-row" key={item.status}>
                    <span className="text-small">{ORDER_STATUS_LABELS[item.status]}</span>
                    <div className="admin-bar-track">
                      <div
                        className="admin-bar-fill admin-bar-fill--green"
                        style={{
                          width: `${Math.round((item.count / Math.max(1, metrics.totalOrders)) * 100)}%`,
                        }}
                      />
                    </div>
                    <strong style={{ textAlign: 'right' }}>{item.count}</strong>
                  </div>
                ))}
              </div>
            </section>
          </div>

          {/* Recent Admin Activity */}
          <section className="card" style={{ marginTop: 24 }} aria-labelledby="admin-activity-heading">
            <div className="detail-header">
              <h2 id="admin-activity-heading" className="admin-section-title">
                Recent Admin Audit Activity
              </h2>
              <span className="badge badge--outline">Immutable Audit Log</span>
            </div>
            <div className="customer-table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Timestamp</th>
                    <th scope="col">Action</th>
                    <th scope="col">Module</th>
                    <th scope="col">Administrator</th>
                    <th scope="col">Audit Details</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentActivity.map((entry) => (
                    <tr key={entry.id}>
                      <td className="text-small text-secondary">{entry.timestamp}</td>
                      <td><strong>{entry.action}</strong></td>
                      <td><span className="badge badge--outline">{entry.entityType}</span></td>
                      <td className="text-small">{entry.actorEmail}</td>
                      <td className="text-small">{entry.details}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
