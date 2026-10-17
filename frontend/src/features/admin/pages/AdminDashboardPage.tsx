import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Notice from '../../../components/common/Notice';
import { env } from '../../../lib/env';
import { formatINR, formatPackSize, getErrorMessage } from '../../../lib/api';
import {
  getAdminDashboard,
  getAdminPayments,
  getAdminOrders,
  getAdminOrderById,
  getAdminProducts,
  getAdminRefunds,
  approveAdminPayment,
  rejectAdminPayment,
} from '../api';
import type {
  AdminDashboardMetrics,
  AdminOrderDetail,
  AdminPaymentSubmission,
  AdminProduct,
  AdminRefundRecord,
  ApprovePaymentRequest,
} from '../types';
import {
  SAMPLE_ADMIN_ORDERS,
  SAMPLE_ADMIN_PAYMENTS,
  SAMPLE_ADMIN_PRODUCTS,
  SAMPLE_ADMIN_REFUNDS,
} from '../lib/referenceData';
import {
  calculateNetProfit,
  calculateProductsSold,
  notifyAdminDataChanged,
  subscribeAdminDataChanged,
  validatePaymentApproval,
} from '../lib/orderStateMachine';
import {
  StatCard,
  StatusBadge,
  DetailDrawer,
  ImagePreview,
  AdminTimeline,
  LoadingSkeleton,
  useAdminToast,
} from '../components';

export default function AdminDashboardPage() {
  const { showToast } = useAdminToast();

  const [dashboardMetrics, setDashboardMetrics] = useState<AdminDashboardMetrics | null>(null);
  const [orders, setOrders] = useState<AdminOrderDetail[]>(SAMPLE_ADMIN_ORDERS);
  const [payments, setPayments] = useState<AdminPaymentSubmission[]>(SAMPLE_ADMIN_PAYMENTS);
  const [products, setProducts] = useState<AdminProduct[]>(SAMPLE_ADMIN_PRODUCTS);
  const [refunds, setRefunds] = useState<AdminRefundRecord[]>(SAMPLE_ADMIN_REFUNDS);

  const [loading, setLoading] = useState(Boolean(env.apiBaseUrl));
  const [error, setError] = useState('');
  const [isLive, setIsLive] = useState(false);

  // Drawers / modals for Pending Payment Confirmations actions
  const [selectedPayment, setSelectedPayment] = useState<AdminPaymentSubmission | null>(null);
  const [screenshotPayment, setScreenshotPayment] = useState<AdminPaymentSubmission | null>(null);
  const [viewingOrder, setViewingOrder] = useState<AdminOrderDetail | null>(null);

  // Bank credit verification form state
  const [receivingBankAccount, setReceivingBankAccount] = useState(
    'Axis Bank · 8000961030@okbizaxis',
  );
  const [verifiedAmountInput, setVerifiedAmountInput] = useState('');
  const [verifiedUtrInput, setVerifiedUtrInput] = useState('');
  const [bankCreditRefInput, setBankCreditRefInput] = useState('');
  const [transactionStatus, setTransactionStatus] = useState<'CREDITED' | 'MISMATCH'>('CREDITED');
  const [verificationNotes, setVerificationNotes] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [validationError, setValidationError] = useState('');
  const [busy, setBusy] = useState(false);

  const loadDashboardData = useCallback(async (silent = false) => {
    if (!env.apiBaseUrl) {
      setLoading(false);
      return;
    }
    if (!silent) {
      setLoading(true);
    }
    setError('');
    try {
      const [dashRes, paymentsRes, ordersRes, productsRes, refundsRes] = await Promise.all([
        getAdminDashboard(),
        getAdminPayments({ status: 'ALL' }),
        getAdminOrders({ status: 'ALL', paymentStatus: 'ALL' }),
        getAdminProducts().catch(() => SAMPLE_ADMIN_PRODUCTS),
        getAdminRefunds({ status: 'ALL' }).catch(() => ({ items: SAMPLE_ADMIN_REFUNDS, total: 0 })),
      ]);

      const detailedOrders = await Promise.all(
        ordersRes.items.map((item) => getAdminOrderById(item.id).catch(() => null)),
      );

      setDashboardMetrics(dashRes.metrics);
      setPayments(paymentsRes.items);
      const resolvedOrders = detailedOrders.filter(
        (item): item is AdminOrderDetail => item !== null,
      );
      if (resolvedOrders.length > 0) {
        setOrders(resolvedOrders);
      }
      setProducts(productsRes);
      setRefunds(refundsRes.items);
      setIsLive(true);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDashboardData(false);

    const unsubscribe = subscribeAdminDataChanged(() => {
      void loadDashboardData(true);
    });
    const handleWindowFocus = () => {
      if (env.apiBaseUrl) {
        void loadDashboardData(true);
      }
    };
    window.addEventListener('focus', handleWindowFocus);
    return () => {
      unsubscribe();
      window.removeEventListener('focus', handleWindowFocus);
    };
  }, [loadDashboardData]);

  // Card 1: Products Sold (total product units from delivered/completed orders)
  const productsSoldCount = useMemo(
    () => calculateProductsSold(orders, dashboardMetrics?.productsSoldCount),
    [orders, dashboardMetrics],
  );

  // Card 2: Net Profit (completed sales revenue minus product costs, refunds & delivery expenses)
  const netProfitAmount = useMemo(
    () =>
      calculateNetProfit({
        orders,
        products,
        refunds,
        metricsNetProfitOverride: dashboardMetrics?.netProfitAmount,
      }),
    [orders, products, refunds, dashboardMetrics],
  );

  // Pending Payment Confirmations queue
  const pendingPayments = useMemo(
    () =>
      payments.filter((payment) =>
        ['PENDING', 'SUBMITTED', 'UNDER_REVIEW'].includes(payment.paymentStatus),
      ),
    [payments],
  );

  function resolveOrderForPayment(payment: AdminPaymentSubmission): AdminOrderDetail | null {
    return (
      orders.find(
        (o) => o.id === payment.orderId || o.orderNumber === payment.orderNumber,
      ) ?? null
    );
  }

  function resolveProductLabel(payment: AdminPaymentSubmission): string {
    if (payment.productSummary) return payment.productSummary;
    const matchingOrder = resolveOrderForPayment(payment);
    if (matchingOrder?.itemsSummary) return matchingOrder.itemsSummary;
    return 'Faki / Supari Order';
  }

  function openReviewPayment(payment: AdminPaymentSubmission) {
    setSelectedPayment(payment);
    setVerifiedUtrInput(payment.submittedUtr);
    setVerifiedAmountInput(
      payment.expectedAmount !== null ? String(payment.expectedAmount) : '',
    );
    setBankCreditRefInput(payment.bankCredit?.bankCreditReference ?? '');
    setVerificationNotes('');
    setRejectionReason(payment.rejectionReason ?? '');
    setValidationError('');
  }

  function handleViewOrder(payment: AdminPaymentSubmission) {
    const order = resolveOrderForPayment(payment);
    if (order) {
      setViewingOrder(order);
    } else {
      showToast(`Order details for ${payment.orderNumber} are not loaded yet.`, 'info');
    }
  }

  async function handleApprovePayment() {
    if (!selectedPayment) return;
    setValidationError('');

    if (!env.apiBaseUrl) {
      setValidationError(
        'Integration Pending: Payment backend (POST /api/admin/payments/{id}/approve) is not connected. Simulated payment approvals are strictly disabled so payments are never marked VERIFIED from frontend state alone.',
      );
      showToast('Payment approval requires the authorized FastAPI backend.', 'warning');
      return;
    }

    const parsedAmount = Number(verifiedAmountInput);
    const existingVerifiedUtrs = payments
      .filter((p) => p.id !== selectedPayment.id && p.paymentStatus === 'VERIFIED')
      .map((p) => p.submittedUtr);
    const existingBankRefs = payments
      .filter((p) => p.id !== selectedPayment.id && p.bankCredit?.bankCreditReference)
      .map((p) => p.bankCredit!.bankCreditReference);

    const approvalPayload: ApprovePaymentRequest = {
      receivingBankAccount: receivingBankAccount.trim(),
      verifiedAmount: parsedAmount,
      verifiedUtr: verifiedUtrInput.trim(),
      transactionStatus: transactionStatus === 'CREDITED' ? 'CREDITED' : ('MISMATCH' as 'CREDITED'),
      bankCreditReference: bankCreditRefInput.trim(),
      notes: verificationNotes.trim() || undefined,
    };

    const validation = validatePaymentApproval({
      currentPaymentStatus: selectedPayment.paymentStatus,
      expectedAmount: selectedPayment.expectedAmount,
      submittedUtr: selectedPayment.submittedUtr,
      approvalInput: approvalPayload,
      existingVerifiedUtrs,
      existingBankCreditRefs: existingBankRefs,
    });

    if (!validation.allowed) {
      setValidationError(validation.reason ?? 'Payment verification validation failed.');
      return;
    }

    setBusy(true);
    try {
      const updated = await approveAdminPayment(selectedPayment.id, approvalPayload);
      setPayments((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      setOrders((prev) =>
        prev.map((order) =>
          order.id === updated.orderId || order.orderNumber === updated.orderNumber
            ? {
                ...order,
                paymentStatus: 'VERIFIED',
                orderStatus: 'AWAITING_CONFIRMATION',
              }
            : order,
        ),
      );
      setSelectedPayment(updated);
      notifyAdminDataChanged();
      showToast(
        `Payment for ${updated.orderNumber} verified. Order moved to AWAITING_CONFIRMATION.`,
        'success',
      );
    } catch (err) {
      setValidationError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleRejectPayment(requestCorrectedProof = false) {
    if (!selectedPayment) return;
    setValidationError('');

    if (rejectionReason.trim().length < 5) {
      setValidationError(
        'Enter a clear rejection reason (at least 5 characters) before rejecting payment proof.',
      );
      return;
    }

    if (!env.apiBaseUrl) {
      setValidationError(
        'Integration Pending: Payment backend (POST /api/admin/payments/{id}/reject) is not connected.',
      );
      showToast('Backend integration pending — cannot mutate payment status.', 'warning');
      return;
    }

    setBusy(true);
    try {
      const updated = await rejectAdminPayment(selectedPayment.id, {
        reason: rejectionReason.trim(),
        requestCorrectedProof,
      });
      setPayments((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      setSelectedPayment(updated);
      notifyAdminDataChanged();
      showToast(
        requestCorrectedProof
          ? `Requested corrected payment proof for ${updated.orderNumber}.`
          : `Payment proof for ${updated.orderNumber} marked REJECTED.`,
        'info',
      );
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
          <h1 className="page__header">Dashboard</h1>
          <p className="page__subtitle">
            Completed product sales, net profit, and pending payment confirmations.
          </p>
        </div>
      </div>

      {!isLive && (
        <Notice title="Backend integration pending — Reference overview">
          FastAPI (<code>GET /api/admin/dashboard</code>) is not connected yet. Metrics below are computed from real order and cost records without fabricated figures.
        </Notice>
      )}
      {error && <Notice tone="error" title="Dashboard sync failed">{error}</Notice>}

      {loading ? (
        <LoadingSkeleton rows={5} />
      ) : (
        <>
          {/* Minimal 2-Card Summary: Products Sold & Net Profit */}
          <section aria-label="Dashboard summary metrics">
            <div className="admin-kpi-grid">
              <StatCard
                label="Products Sold"
                value={`${productsSoldCount} ${productsSoldCount === 1 ? 'Item' : 'Items'}`}
                subtitle="Total product units from delivered & verified orders"
              />
              <StatCard
                label="Net Profit"
                value={netProfitAmount !== null ? formatINR(netProfitAmount) : 'Not configured'}
                subtitle={
                  netProfitAmount !== null
                    ? 'Completed sales minus product costs, delivery & refunds'
                    : 'Configure product cost & selling prices in Price Management'
                }
              />
            </div>
          </section>

          {/* Pending Payment Confirmations Table */}
          <section
            className="card"
            aria-labelledby="pending-payment-confirmations-heading"
          >
            <div className="detail-header">
              <div>
                <h2
                  id="pending-payment-confirmations-heading"
                  className="admin-section-title"
                  style={{ marginBottom: 4 }}
                >
                  Pending Payment Confirmations
                </h2>
                <p className="text-small text-secondary">
                  Verify the actual bank statement credit before approving payment. Approving sets{' '}
                  <code>Payment Status = VERIFIED</code> and{' '}
                  <code>Order Status = AWAITING_CONFIRMATION</code>.
                </p>
              </div>
              <span className="badge badge--warning">
                {pendingPayments.length} Pending
              </span>
            </div>

            <div
              className="admin-table-wrap"
              role="region"
              aria-label="Pending payment confirmations"
              tabIndex={0}
            >
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Order ID</th>
                    <th scope="col">Customer Name</th>
                    <th scope="col">Product</th>
                    <th scope="col">Total Amount</th>
                    <th scope="col">Payment UTR</th>
                    <th scope="col">Payment Screenshot</th>
                    <th scope="col">Submitted Date</th>
                    <th scope="col">Payment Status</th>
                    <th scope="col">Review Payment Action</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingPayments.map((payment) => (
                    <tr key={payment.id}>
                      <td>
                        <strong>{payment.orderNumber}</strong>
                      </td>
                      <td>
                        <strong>{payment.customerName}</strong>
                        <p className="text-small text-secondary">{payment.customerPhone}</p>
                      </td>
                      <td>{resolveProductLabel(payment)}</td>
                      <td>
                        <strong>{formatINR(payment.expectedAmount)}</strong>
                      </td>
                      <td>
                        <code className="admin-utr-code">{payment.submittedUtr}</code>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn btn--outline btn--sm"
                          onClick={() => setScreenshotPayment(payment)}
                        >
                          View Screenshot
                        </button>
                      </td>
                      <td className="text-small">{payment.submissionDate}</td>
                      <td>
                        <StatusBadge status={payment.paymentStatus} kind="payment" />
                      </td>
                      <td>
                        <div className="admin-action-group">
                          <button
                            type="button"
                            className="btn btn--outline btn--sm"
                            onClick={() => handleViewOrder(payment)}
                          >
                            View Order
                          </button>
                          <button
                            type="button"
                            className="btn btn--primary btn--sm"
                            onClick={() => openReviewPayment(payment)}
                          >
                            Review Payment
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {pendingPayments.length === 0 && (
                    <tr>
                      <td colSpan={9} className="text-secondary">
                        No pending payment proofs currently require verification.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {/* View Screenshot Modal */}
      {screenshotPayment && (
        <div
          className="admin-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="screenshot-modal-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setScreenshotPayment(null);
          }}
        >
          <div className="admin-modal">
            <div className="detail-header">
              <div>
                <h2 id="screenshot-modal-title" style={{ marginBottom: 2 }}>
                  Payment Screenshot — {screenshotPayment.orderNumber}
                </h2>
                <p className="text-small text-secondary">
                  Customer: {screenshotPayment.customerName} · UTR: {screenshotPayment.submittedUtr}
                </p>
              </div>
              <button
                type="button"
                className="btn btn--outline btn--sm"
                onClick={() => setScreenshotPayment(null)}
              >
                Close
              </button>
            </div>
            <ImagePreview
              src={screenshotPayment.signedScreenshotUrl}
              alt={`Payment screenshot for ${screenshotPayment.orderNumber}`}
              privateStoragePath={screenshotPayment.privateScreenshotPath}
              caption="Verify actual bank credit in the merchant bank statement before approving payment."
            />
            <div className="admin-modal__actions">
              <button
                type="button"
                className="btn btn--outline btn--sm"
                onClick={() => setScreenshotPayment(null)}
              >
                Close
              </button>
              <button
                type="button"
                className="btn btn--primary btn--sm"
                onClick={() => {
                  const target = screenshotPayment;
                  setScreenshotPayment(null);
                  openReviewPayment(target);
                }}
              >
                Review Payment
              </button>
            </div>
          </div>
        </div>
      )}

      {/* View Order Drawer */}
      <DetailDrawer
        open={viewingOrder !== null}
        title={viewingOrder ? `Order ${viewingOrder.orderNumber}` : 'Order Details'}
        subtitle={
          viewingOrder
            ? `${viewingOrder.customerName} · ${viewingOrder.phone}`
            : undefined
        }
        onClose={() => setViewingOrder(null)}
        footer={
          viewingOrder && (
            <div className="admin-action-group" style={{ width: '100%', justifyContent: 'space-between' }}>
              <button
                type="button"
                className="btn btn--outline btn--sm"
                onClick={() => setViewingOrder(null)}
              >
                Close
              </button>
              <Link
                to={`/admin/orders?orderId=${encodeURIComponent(viewingOrder.orderNumber)}`}
                className="btn btn--dark btn--sm"
              >
                Open in Order Management
              </Link>
            </div>
          )
        }
      >
        {viewingOrder && (
          <div>
            <dl className="admin-kv-grid">
              <div className="admin-kv-item">
                <dt>Order ID</dt>
                <dd>{viewingOrder.orderNumber}</dd>
              </div>
              <div className="admin-kv-item">
                <dt>Customer</dt>
                <dd>{viewingOrder.customerName}</dd>
              </div>
              <div className="admin-kv-item">
                <dt>Phone</dt>
                <dd>{viewingOrder.phone}</dd>
              </div>
              <div className="admin-kv-item">
                <dt>Order Status</dt>
                <dd><StatusBadge status={viewingOrder.orderStatus} kind="order" /></dd>
              </div>
              <div className="admin-kv-item">
                <dt>Payment Status</dt>
                <dd><StatusBadge status={viewingOrder.paymentStatus} kind="payment" /></dd>
              </div>
              <div className="admin-kv-item">
                <dt>Total Amount</dt>
                <dd>{formatINR(viewingOrder.totalAmount)}</dd>
              </div>
              <div className="admin-kv-item" style={{ gridColumn: '1 / -1' }}>
                <dt>Delivery Address</dt>
                <dd>{viewingOrder.address}</dd>
              </div>
            </dl>

            <h3 style={{ fontSize: 18, marginBottom: 10 }}>Ordered Items</h3>
            <div className="card" style={{ padding: 16 }}>
              {viewingOrder.items.map((item) => (
                <div
                  key={item.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 12,
                    paddingBottom: 10,
                    marginBottom: 10,
                    borderBottom: '1px solid var(--color-border)',
                  }}
                >
                  <div>
                    <strong>
                      {item.productName} (<span lang="gu">{item.productNameGu}</span>)
                    </strong>
                    <p className="text-small text-secondary">
                      {formatPackSize(item.packSize)} × {item.quantity}
                    </p>
                  </div>
                  <strong>{formatINR(item.lineTotal)}</strong>
                </div>
              ))}
              <div className="summary-row">
                <span>Total Amount</span>
                <strong>{formatINR(viewingOrder.totalAmount)}</strong>
              </div>
            </div>
          </div>
        )}
      </DetailDrawer>

      {/* Review Payment Drawer (Approve Payment / Reject Payment) */}
      <DetailDrawer
        open={selectedPayment !== null}
        title={
          selectedPayment
            ? `Review Payment — ${selectedPayment.orderNumber}`
            : 'Review Payment'
        }
        subtitle={
          selectedPayment
            ? `Customer: ${selectedPayment.customerName} (${selectedPayment.customerPhone})`
            : undefined
        }
        onClose={() => setSelectedPayment(null)}
      >
        {selectedPayment && (
          <div>
            {validationError && (
              <Notice tone="error" title="Payment Verification Blocked">
                {validationError}
              </Notice>
            )}

            <dl className="admin-kv-grid">
              <div className="admin-kv-item">
                <dt>Order ID</dt>
                <dd>{selectedPayment.orderNumber}</dd>
              </div>
              <div className="admin-kv-item">
                <dt>Product</dt>
                <dd>{resolveProductLabel(selectedPayment)}</dd>
              </div>
              <div className="admin-kv-item">
                <dt>Total Amount</dt>
                <dd>{formatINR(selectedPayment.expectedAmount)}</dd>
              </div>
              <div className="admin-kv-item">
                <dt>Payment UTR</dt>
                <dd><code className="admin-utr-code">{selectedPayment.submittedUtr}</code></dd>
              </div>
              <div className="admin-kv-item">
                <dt>Payment Status</dt>
                <dd><StatusBadge status={selectedPayment.paymentStatus} kind="payment" /></dd>
              </div>
              <div className="admin-kv-item">
                <dt>Order Status</dt>
                <dd><StatusBadge status={selectedPayment.orderStatus} kind="order" /></dd>
              </div>
            </dl>

            <h3 style={{ fontSize: 18, marginBottom: 8 }}>Payment Screenshot</h3>
            <div style={{ marginBottom: 20 }}>
              <ImagePreview
                src={selectedPayment.signedScreenshotUrl}
                alt={`Payment screenshot for ${selectedPayment.orderNumber}`}
                privateStoragePath={selectedPayment.privateScreenshotPath}
                caption="Verify the actual bank credit in your statement before approving payment."
              />
            </div>

            <section
              className="card card--tinted"
              style={{ marginBottom: 20 }}
              aria-labelledby="dashboard-bank-verify-heading"
            >
              <h3 id="dashboard-bank-verify-heading" style={{ fontSize: 18, marginBottom: 6 }}>
                Verify Actual Bank Credit
              </h3>
              <p className="text-small text-secondary" style={{ marginBottom: 14 }}>
                Approving payment sets <code>Payment Status = VERIFIED</code> and{' '}
                <code>Order Status = AWAITING_CONFIRMATION</code>. Order confirmation remains a separate action in Order Management.
              </p>

              <div className="form-row">
                <div>
                  <label htmlFor="dash-verify-bank">Receiving Bank Account</label>
                  <input
                    id="dash-verify-bank"
                    className="input"
                    value={receivingBankAccount}
                    onChange={(e) => setReceivingBankAccount(e.target.value)}
                    disabled={selectedPayment.paymentStatus === 'VERIFIED' || busy}
                  />
                </div>
                <div>
                  <label htmlFor="dash-verify-tx-status">Bank Transaction Status</label>
                  <select
                    id="dash-verify-tx-status"
                    className="input"
                    value={transactionStatus}
                    onChange={(e) =>
                      setTransactionStatus(e.target.value as 'CREDITED' | 'MISMATCH')
                    }
                    disabled={selectedPayment.paymentStatus === 'VERIFIED' || busy}
                  >
                    <option value="CREDITED">CREDITED (Settled in bank)</option>
                    <option value="MISMATCH">MISMATCH / NOT FOUND</option>
                  </select>
                </div>
              </div>

              <div className="form-row">
                <div>
                  <label htmlFor="dash-verify-utr">Verified 12-Digit UTR</label>
                  <input
                    id="dash-verify-utr"
                    className="input"
                    maxLength={12}
                    placeholder="12-digit UTR from bank statement"
                    value={verifiedUtrInput}
                    onChange={(e) => setVerifiedUtrInput(e.target.value.replace(/\D/g, ''))}
                    disabled={selectedPayment.paymentStatus === 'VERIFIED' || busy}
                  />
                </div>
                <div>
                  <label htmlFor="dash-verify-amount">Verified Bank Credit Amount (₹)</label>
                  <input
                    id="dash-verify-amount"
                    type="number"
                    step="0.01"
                    className="input"
                    placeholder="Exact amount credited"
                    value={verifiedAmountInput}
                    onChange={(e) => setVerifiedAmountInput(e.target.value)}
                    disabled={selectedPayment.paymentStatus === 'VERIFIED' || busy}
                  />
                </div>
              </div>

              <div style={{ marginBottom: 14 }}>
                <label htmlFor="dash-verify-ref">Bank Credit Reference / Statement Entry ID</label>
                <input
                  id="dash-verify-ref"
                  className="input"
                  placeholder="e.g. AXIS-CR-20261015-8841"
                  value={bankCreditRefInput}
                  onChange={(e) => setBankCreditRefInput(e.target.value)}
                  disabled={selectedPayment.paymentStatus === 'VERIFIED' || busy}
                />
              </div>

              <div style={{ marginBottom: 14 }}>
                <label htmlFor="dash-verify-notes">Verification Notes (Optional)</label>
                <input
                  id="dash-verify-notes"
                  className="input"
                  placeholder="Optional audit note…"
                  value={verificationNotes}
                  onChange={(e) => setVerificationNotes(e.target.value)}
                  disabled={selectedPayment.paymentStatus === 'VERIFIED' || busy}
                />
              </div>

              {selectedPayment.paymentStatus !== 'VERIFIED' ? (
                <button
                  type="button"
                  className="btn btn--primary btn--full"
                  disabled={busy}
                  onClick={handleApprovePayment}
                >
                  {busy ? 'Approving via FastAPI…' : 'Approve Payment'}
                </button>
              ) : (
                <Notice tone="success" title="Payment Verified">
                  Payment is verified and order is awaiting confirmation.
                </Notice>
              )}
            </section>

            {selectedPayment.paymentStatus !== 'VERIFIED' && (
              <section className="card" style={{ marginBottom: 20 }}>
                <h3 style={{ fontSize: 18, marginBottom: 8 }}>Reject Payment</h3>
                <label htmlFor="dash-reject-reason">Rejection Reason</label>
                <textarea
                  id="dash-reject-reason"
                  className="input"
                  placeholder="State why the payment proof is rejected…"
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  disabled={busy}
                />
                <div className="admin-action-group" style={{ marginTop: 12 }}>
                  <button
                    type="button"
                    className="btn btn--outline btn--sm"
                    disabled={busy}
                    onClick={() => handleRejectPayment(true)}
                  >
                    Request Corrected Proof
                  </button>
                  <button
                    type="button"
                    className="btn btn--danger btn--sm"
                    disabled={busy}
                    onClick={() => handleRejectPayment(false)}
                  >
                    Reject Payment
                  </button>
                </div>
              </section>
            )}

            <h3 style={{ fontSize: 18, marginBottom: 8 }}>Verification Audit History</h3>
            <AdminTimeline
              items={selectedPayment.verificationHistory.map((item) => ({
                id: item.id,
                label: item.action,
                timestamp: item.timestamp,
                description: item.notes,
                actor: item.actorName,
              }))}
            />
          </div>
        )}
      </DetailDrawer>
    </div>
  );
}
