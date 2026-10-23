import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Notice from '../../../components/common/Notice';
import { env } from '../../../lib/env';
import { formatINR, getErrorMessage, resolveApiUrl } from '../../../lib/api';
import { formatDateTime } from '../lib/formatDateTime';
import {
  getAdminPayments,
  getAdminPaymentById,
  getAdminPaymentProof,
  getAdminPaymentReceipt,
  getAdminPaymentReceipts,
  archiveDeliveredPaymentProof,
  startAdminPaymentReview,
  approveAdminPayment,
  rejectAdminPayment,
} from '../api';
import type { AdminPaymentSubmission, AdminPaymentStatus } from '../types';
import { PAYMENT_STATUS_LABELS } from '../lib/orderStateMachine';
import DuplicateScreenshotNotice from '../components/DuplicateScreenshotNotice';
import {
  StatCard,
  StatusBadge,
  DetailDrawer,
  ImagePreview,
  AdminTimeline,
  LoadingSkeleton,
  useAdminToast,
} from '../components';

const PAYMENT_FILTER_OPTIONS: Array<AdminPaymentStatus | 'ALL'> = [
  'ALL',
  'SUBMITTED',
  'UNDER_REVIEW',
  'VERIFIED',
  'REJECTED',
  'PENDING',
];

export default function AdminPaymentsPage() {
  const [searchParams] = useSearchParams();
  const { showToast } = useAdminToast();

  const initialStatus = searchParams.get('status') as AdminPaymentStatus | null;
  const initialQuery = searchParams.get('order') ?? '';

  const [payments, setPayments] = useState<AdminPaymentSubmission[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [query, setQuery] = useState(initialQuery);
  const [statusFilter, setStatusFilter] = useState<AdminPaymentStatus | 'ALL'>(
    initialStatus && PAYMENT_FILTER_OPTIONS.includes(initialStatus) ? initialStatus : 'ALL',
  );
  const [selectedPayment, setSelectedPayment] = useState<AdminPaymentSubmission | null>(null);

  const [verificationNotes, setVerificationNotes] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [validationError, setValidationError] = useState('');
  const [busy, setBusy] = useState(false);
  const [selectedReceiptIds, setSelectedReceiptIds] = useState<string[]>([]);
  const [receiptBusy, setReceiptBusy] = useState(false);
  const [selectionError, setSelectionError] = useState('');

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
    getAdminPayments({
      search: query || undefined,
      status: statusFilter,
      page,
    })
      .then((res) => {
        if (active) {
          setPayments(res.items);
          setTotalPages(res.totalPages ?? 1);
          setSelectionError('');
          const focus = searchParams.get('payment');
          const focused = focus ? res.items.find((item) => item.id === focus) : undefined;
          if (focused) openPaymentInspector(focused);
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
  }, [query, statusFilter, page]);

  function openPaymentInspector(payment: AdminPaymentSubmission) {
    setSelectedPayment(payment);
    setVerificationNotes('');
    setRejectionReason(payment.rejectionReason ?? '');
    setValidationError('');
    if (env.apiBaseUrl && payment.orderStatus !== 'DELIVERED' && !payment.signedScreenshotUrl) {
      void getAdminPaymentProof(payment.id)
        .then((proof) => {
          setSelectedPayment((prev) =>
            prev && prev.id === payment.id
              ? { ...prev, signedScreenshotUrl: proof.signedUrl }
              : prev,
          );
        })
        .catch(() => undefined);
    }
  }

  function openMatchedPayment(paymentId: string) {
    getAdminPaymentById(paymentId)
      .then(openPaymentInspector)
      .catch((err) => showToast(getErrorMessage(err), 'error'));
  }

  const filteredPayments = payments.filter((p) => {
    if (statusFilter !== 'ALL' && p.paymentStatus !== statusFilter) return false;
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return `${p.orderNumber} ${p.customerName}`
      .toLowerCase()
      .includes(q);
  });
  const verifiedReceiptsTotal = payments
    .filter((payment) => payment.paymentStatus === 'VERIFIED')
    .reduce((sum, payment) => sum + (payment.expectedAmount ?? 0), 0);

  function saveReceipt(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function downloadReceipt(payment: AdminPaymentSubmission) {
    setReceiptBusy(true);
    try {
      const { blob, filename } = await getAdminPaymentReceipt(payment.id);
      saveReceipt(blob, filename || `payment-receipt-${payment.id}.pdf`);
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    } finally {
      setReceiptBusy(false);
    }
  }

  async function retryScreenshotCleanup(payment: AdminPaymentSubmission) {
    setReceiptBusy(true);
    try {
      const result = await archiveDeliveredPaymentProof(payment.id);
      showToast(result.complete ? 'Payment screenshot cleanup completed.' : 'Receipt archive is unavailable; the original screenshot was kept. Please retry later.', result.complete ? 'success' : 'warning');
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    } finally {
      setReceiptBusy(false);
    }
  }

  async function downloadSelectedReceipts() {
    if (selectedReceiptIds.length === 0) return;
    if (selectedReceiptIds.length > 100) {
      setSelectionError('Select at most 100 payments per download.');
      return;
    }
    setSelectionError('');
    setReceiptBusy(true);
    try {
      const { blob, filename } = await getAdminPaymentReceipts(selectedReceiptIds);
      saveReceipt(blob, filename || 'payment-receipts.zip');
    } catch (err) {
      setSelectionError(getErrorMessage(err));
    } finally {
      setReceiptBusy(false);
    }
  }

  async function handleApprovePayment() {
    if (!selectedPayment) return;
    setValidationError('');

    // If backend is disconnected, show integration-pending state and NEVER simulate approval
    if (!env.apiBaseUrl) {
      setValidationError(
        'Integration Pending: Payment backend (POST /api/admin/payments/{id}/approve) is not connected. Simulated payment approvals are strictly disabled for financial security.',
      );
      showToast('Payment approval blocked: FastAPI backend is not connected.', 'warning');
      return;
    }
    if (!selectedPayment.signedScreenshotUrl) {
      setValidationError('The customer screenshot has not loaded. Check it before approving.');
      return;
    }

    setBusy(true);
    try {
      const notes = verificationNotes.trim() || undefined;
      // The server tracks SUBMITTED -> UNDER_REVIEW -> VERIFIED; the owner only sees "approve".
      const reviewed =
        selectedPayment.paymentStatus === 'SUBMITTED'
          ? await startAdminPaymentReview(selectedPayment.id, { notes })
          : selectedPayment;
      const updated = await approveAdminPayment(reviewed.id, { notes });
      setPayments((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      setSelectedPayment(updated);
      showToast(`Payment for ${updated.orderNumber} approved. Order moved to AWAITING_CONFIRMATION.`, 'success');
    } catch (err) {
      setValidationError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleRejectOrRequestProof(requestCorrectedProof: boolean) {
    if (!selectedPayment) return;
    setValidationError('');

    if (rejectionReason.trim().length < 5) {
      setValidationError(
        'Enter a clear reason (at least 5 characters) explaining why the payment proof was rejected or needs correction.',
      );
      return;
    }

    if (!env.apiBaseUrl) {
      setValidationError(
        'Integration Pending: Payment backend (POST /api/admin/payments/{id}/reject) is not connected.',
      );
      showToast('Backend integration pending — cannot mutate payment state.', 'warning');
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
          <h1 className="page__header">Payment Screenshots</h1>
          <p className="page__subtitle">
            Look at the screenshot the customer uploaded, then approve or reject the payment.
          </p>
        </div>
      </div>

      {/* Mandatory Security Policy Banner */}
      <Notice tone="warning" title="Check the screenshot carefully">
        The customer's uploaded screenshot is the only evidence of payment: check the amount, the receiver and that it shows a successful payment. Approving sets <code>Payment = VERIFIED</code> and <code>Order = AWAITING_CONFIRMATION</code> (never directly to packing or shipping).
      </Notice>

      {!isLive && (
        <Notice title="Payment data unavailable">
          Connect the local FastAPI server and private Neon storage to load payment proofs. No sample payments are shown and approvals remain backend-only.
        </Notice>
      )}
      {error && <Notice tone="error" title="Payment queue sync error">{error}</Notice>}

      <div className="stats-grid">
        <StatCard
          label="Pending Payment Queue"
          value={isLive ? (
            payments.filter((p) => ['SUBMITTED', 'UNDER_REVIEW'].includes(p.paymentStatus)).length
          ) : 'Unavailable'}
          subtitle="Screenshot awaiting a decision"
        />
        <StatCard
          label="Approved Payments"
          value={isLive ? payments.filter((p) => p.paymentStatus === 'VERIFIED').length : 'Unavailable'}
          subtitle="Screenshot approved by the owner"
        />
        <StatCard
          label="Rejected"
          value={isLive ? payments.filter((p) => p.paymentStatus === 'REJECTED').length : 'Unavailable'}
        />
        <StatCard
          label="Verified Receipts Total"
          value={isLive ? formatINR(verifiedReceiptsTotal) : 'Unavailable'}
          subtitle="Unverified proofs excluded"
        />
      </div>

      {/* Filters */}
      <div className="card card--tinted customer-filters">
        <div style={{ flex: '2 1 280px' }}>
          <label htmlFor="payment-search">Search Order Number or Customer</label>
          <input
            id="payment-search"
            type="search"
            className="input"
            placeholder="Order number or customer name"
            value={query}
            onChange={(e) => { setPage(1); setSelectedReceiptIds([]); setSelectionError(''); setQuery(e.target.value); }}
          />
        </div>
        <div className="customer-filter-chips" aria-label="Filter payments by status">
          {PAYMENT_FILTER_OPTIONS.map((status) => (
            <button
              key={status}
              type="button"
              className={`chip${statusFilter === status ? ' chip--active' : ''}`}
              aria-pressed={statusFilter === status}
              onClick={() => { setPage(1); setSelectedReceiptIds([]); setSelectionError(''); setStatusFilter(status); }}
            >
              {status === 'ALL' ? 'All' : PAYMENT_STATUS_LABELS[status]}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <LoadingSkeleton rows={5} />
      ) : (
        <div className="card">
          {selectionError && <Notice tone="error" title="Receipt selection">{selectionError}</Notice>}
          <div className="admin-action-group" style={{ marginBottom: 12 }}>
            <button type="button" className="btn btn--outline btn--sm" disabled={selectedReceiptIds.length === 0 || receiptBusy} onClick={downloadSelectedReceipts}>
              {receiptBusy ? 'Preparing receipts…' : `Download selected receipts (${selectedReceiptIds.length})`}
            </button>
            <span className="text-small text-secondary">Select up to 100 payments across pages. Large downloads may need smaller batches.</span>
          </div>
          <div className="admin-action-group" style={{ marginTop: 12 }}>
            <button type="button" className="btn btn--outline btn--sm" disabled={page <= 1 || loading} onClick={() => setPage((current) => current - 1)}>Previous page</button>
            <span className="text-small text-secondary">Page {page} of {totalPages}</span>
            <button type="button" className="btn btn--outline btn--sm" disabled={page >= totalPages || loading} onClick={() => setPage((current) => current + 1)}>Next page</button>
          </div>
          <div className="customer-table-scroll" role="region" aria-label="Payment verification queue" tabIndex={0}>
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col"><input type="checkbox" aria-label="Select all shown payments" checked={filteredPayments.length > 0 && filteredPayments.every((payment) => selectedReceiptIds.includes(payment.id))} onChange={(event) => {
                    if (event.target.checked && new Set([...selectedReceiptIds, ...filteredPayments.map((payment) => payment.id)]).size > 100) {
                      setSelectionError('Select at most 100 payments per download. Narrow the filter or select individual payments.');
                      return;
                    }
                    setSelectionError('');
                    setSelectedReceiptIds((current) => event.target.checked
                      ? [...new Set([...current, ...filteredPayments.map((payment) => payment.id)])]
                      : current.filter((id) => !filteredPayments.some((payment) => payment.id === id)));
                  }} /></th>
                  <th scope="col">Order Number</th>
                  <th scope="col">Customer</th>
                  <th scope="col">Expected Amount</th>
                  <th scope="col">Screenshot Proof</th>
                  <th scope="col">Submission Date</th>
                  <th scope="col">Payment Status</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredPayments.map((payment) => (
                  <tr key={payment.id}>
                    <td><input type="checkbox" aria-label={`Select receipt for ${payment.orderNumber}`} checked={selectedReceiptIds.includes(payment.id)} onChange={(event) => {
                      if (event.target.checked && selectedReceiptIds.length >= 100) {
                        setSelectionError('Select at most 100 payments per download.');
                        return;
                      }
                      setSelectionError('');
                      setSelectedReceiptIds((current) => event.target.checked ? [...current, payment.id] : current.filter((id) => id !== payment.id));
                    }} /></td>
                    <td>
                      <strong>{payment.orderNumber}</strong>
                      <p className="text-small text-secondary">Order: {payment.orderStatus}</p>
                    </td>
                    <td>
                      <strong>{payment.customerName}</strong>
                      <p className="text-small text-secondary">{payment.customerPhone}</p>
                    </td>
                    <td><strong>{formatINR(payment.expectedAmount)}</strong></td>
                    <td>
                      <span className="badge badge--outline">Private Bucket</span>
                    </td>
                    <td className="text-small">{formatDateTime(payment.submissionDate)}</td>
                    <td>
                      <StatusBadge status={payment.paymentStatus} kind="payment" />
                      {payment.duplicateScreenshot && payment.duplicateScreenshot.count > 0 && (
                        <p style={{ marginTop: 4 }}>
                          <span className="badge badge--warning" title="This exact image file was uploaded before. Open the payment to see where.">
                            Possible duplicate screenshot
                          </span>
                        </p>
                      )}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn btn--primary btn--sm"
                        onClick={() => openPaymentInspector(payment)}
                      >
                        {['SUBMITTED', 'UNDER_REVIEW'].includes(payment.paymentStatus) ? 'Check Screenshot' : 'View'}
                      </button>
                    </td>
                  </tr>
                ))}
                {filteredPayments.length === 0 && (
                  <tr>
                    <td colSpan={8} className="text-secondary">
                      No payment submissions match these filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Manual Payment Verification Drawer */}
      <DetailDrawer
        open={selectedPayment !== null}
        title={
          selectedPayment
            ? `Payment — ${selectedPayment.orderNumber}`
            : 'Payment'
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
              <Notice tone="error" title="Action blocked">
                {validationError}
              </Notice>
            )}

            <dl className="admin-kv-grid">
              <div className="admin-kv-item">
                <dt>Order Number</dt>
                <dd>{selectedPayment.orderNumber}</dd>
              </div>
              <div className="admin-kv-item">
                <dt>Expected Order Amount</dt>
                <dd>{formatINR(selectedPayment.expectedAmount)}</dd>
              </div>
              <div className="admin-kv-item">
                <dt>Current Payment Status</dt>
                <dd><StatusBadge status={selectedPayment.paymentStatus} kind="payment" /></dd>
              </div>
              <div className="admin-kv-item">
                <dt>Current Order Status</dt>
                <dd><StatusBadge status={selectedPayment.orderStatus} kind="order" /></dd>
              </div>
              <div className="admin-kv-item">
                <dt>Submitted At</dt>
                <dd>{formatDateTime(selectedPayment.submissionDate)}</dd>
              </div>
            </dl>

            <DuplicateScreenshotNotice info={selectedPayment.duplicateScreenshot} onOpenPayment={openMatchedPayment} />

            {/* Private Screenshot Section */}
            <h3 style={{ fontSize: 18, marginBottom: 8 }}>
              Customer Payment Screenshot
            </h3>
            <div style={{ marginBottom: 20 }}>
              {selectedPayment.orderStatus === 'DELIVERED' ? (
                <Notice title="Screenshot archive">Both payment images are kept in the downloadable receipt. You can retry cleanup for older delivered orders.</Notice>
              ) : (
                <ImagePreview
                  src={selectedPayment.signedScreenshotUrl ? resolveApiUrl(selectedPayment.signedScreenshotUrl) : undefined}
                  alt={`Payment screenshot for ${selectedPayment.orderNumber}`}
                  privateStoragePath={selectedPayment.privateScreenshotPath}
                  caption="Check the amount, the receiver and that the payment succeeded."
                />
              )}
            </div>
            <button type="button" className="btn btn--outline btn--sm" disabled={receiptBusy} onClick={() => downloadReceipt(selectedPayment)}>
              Download receipt
            </button>
            {selectedPayment.orderStatus === 'DELIVERED' && <button type="button" className="btn btn--outline btn--sm" disabled={receiptBusy} onClick={() => retryScreenshotCleanup(selectedPayment)}>
              Retry screenshot cleanup
            </button>}

            {/* Approve the screenshot */}
            <section className="card card--tinted" style={{ marginBottom: 20 }} aria-labelledby="approve-heading">
              <h3 id="approve-heading" style={{ fontSize: 18, marginBottom: 6 }}>
                Approve Payment
              </h3>
              {['SUBMITTED', 'UNDER_REVIEW'].includes(selectedPayment.paymentStatus) ? (
                <>
                  <div style={{ marginBottom: 14 }}>
                    <label htmlFor="verify-notes">Note (Optional)</label>
                    <input
                      id="verify-notes"
                      className="input"
                      placeholder="Optional audit note…"
                      value={verificationNotes}
                      onChange={(e) => setVerificationNotes(e.target.value)}
                      disabled={busy}
                    />
                  </div>
                  <button
                    type="button"
                    className="btn btn--primary btn--full"
                    disabled={busy}
                    onClick={handleApprovePayment}
                  >
                    {busy ? 'Approving…' : 'Approve Payment (Order → Awaiting Confirmation)'}
                  </button>
                </>
              ) : selectedPayment.paymentStatus === 'VERIFIED' ? (
                <Notice tone="success" title="Payment approved">
                  The screenshot was approved on {formatDateTime(selectedPayment.verificationHistory.find((item) => item.action === 'APPROVED')?.timestamp)}.
                </Notice>
              ) : (
                <Notice tone="warning" title="Payment action unavailable">
                  This payment is no longer waiting for a decision.
                </Notice>
              )}
            </section>

            {/* Reject or Request Corrected Proof */}
            {['SUBMITTED', 'UNDER_REVIEW'].includes(selectedPayment.paymentStatus) && (
              <section className="card" style={{ marginBottom: 20 }}>
                <h3 style={{ fontSize: 18, marginBottom: 8 }}>
                  Reject Payment or Request Corrected Proof
                </h3>
                <label htmlFor="reject-reason">Reason for Rejection / Proof Correction</label>
                <textarea
                  id="reject-reason"
                  className="input"
                  placeholder="e.g. screenshot is unreadable, or the amount does not match the order…"
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  disabled={busy}
                />
                <div className="admin-action-group" style={{ marginTop: 12 }}>
                  <button
                    type="button"
                    className="btn btn--outline btn--sm"
                    disabled={busy}
                    onClick={() => handleRejectOrRequestProof(true)}
                  >
                    Request Corrected Proof
                  </button>
                  <button
                    type="button"
                    className="btn btn--sm"
                    style={{ background: '#B42318', borderColor: '#B42318', color: '#fff' }}
                    disabled={busy}
                    onClick={() => handleRejectOrRequestProof(false)}
                  >
                    Reject Payment
                  </button>
                </div>
              </section>
            )}

            {/* Verification History */}
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
