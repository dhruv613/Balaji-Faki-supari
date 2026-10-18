import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Notice from '../../../components/common/Notice';
import { env } from '../../../lib/env';
import { formatINR, getErrorMessage } from '../../../lib/api';
import {
  getAdminPayments,
  getAdminPaymentProof,
  startAdminPaymentReview,
  approveAdminPayment,
  rejectAdminPayment,
} from '../api';
import type {
  AdminPaymentSubmission,
  AdminPaymentStatus,
  ApprovePaymentRequest,
} from '../types';
import {
  PAYMENT_STATUS_LABELS,
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
  const [query, setQuery] = useState(initialQuery);
  const [statusFilter, setStatusFilter] = useState<AdminPaymentStatus | 'ALL'>(
    initialStatus && PAYMENT_FILTER_OPTIONS.includes(initialStatus) ? initialStatus : 'ALL',
  );
  const [selectedPayment, setSelectedPayment] = useState<AdminPaymentSubmission | null>(null);

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
    })
      .then((res) => {
        if (active) {
          setPayments(res.items);
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

  function openPaymentInspector(payment: AdminPaymentSubmission) {
    setSelectedPayment(payment);
    setVerifiedUtrInput(payment.submittedUtr);
    setVerifiedAmountInput(
      payment.expectedAmount !== null ? String(payment.expectedAmount) : '',
    );
    setBankCreditRefInput(payment.bankCredit?.bankCreditReference ?? '');
    setVerificationNotes('');
    setRejectionReason(payment.rejectionReason ?? '');
    setValidationError('');
    if (env.apiBaseUrl && !payment.signedScreenshotUrl) {
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

  const filteredPayments = payments.filter((p) => {
    if (statusFilter !== 'ALL' && p.paymentStatus !== statusFilter) return false;
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return `${p.orderNumber} ${p.customerName} ${p.submittedUtr} ${p.bankCredit?.bankCreditReference ?? ''}`
      .toLowerCase()
      .includes(q);
  });
  const verifiedReceiptsTotal = payments
    .filter((payment) => payment.paymentStatus === 'VERIFIED')
    .reduce((sum, payment) => sum + (payment.expectedAmount ?? 0), 0);

  async function handleApprovePayment() {
    if (!selectedPayment) return;
    setValidationError('');

    // If backend is disconnected, show integration-pending state and NEVER simulate approval
    if (!env.apiBaseUrl) {
      setValidationError(
        'Integration Pending: Payment backend (POST /api/admin/payments/{id}/approve) is not connected. Simulated payment approvals are strictly disabled for financial security.',
      );
      showToast(
        'Payment approval blocked: FastAPI backend is not connected.',
        'warning',
      );
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
      setSelectedPayment(updated);
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

  async function handleStartPaymentReview() {
    if (!selectedPayment) return;
    setValidationError('');
    if (!env.apiBaseUrl) {
      setValidationError('Integration Pending: FastAPI must start the independent payment review.');
      return;
    }
    if (selectedPayment.paymentStatus !== 'SUBMITTED') {
      setValidationError('Only a submitted proof can enter bank-credit review.');
      return;
    }
    setBusy(true);
    try {
      const updated = await startAdminPaymentReview(selectedPayment.id, {
        notes: verificationNotes.trim() || undefined,
      });
      setPayments((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      setSelectedPayment(updated);
      showToast(`Bank-credit review started for ${updated.orderNumber}.`, 'info');
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
          <h1 className="page__header">Manual Payment Verification</h1>
          <p className="page__subtitle">
            Independently verify UPI bank credits before approving customer payment proofs.
          </p>
        </div>
      </div>

      {/* Mandatory Security Policy Banner */}
      <Notice tone="warning" title="Strict Financial Verification Policy">
        <strong>A screenshot or UTR alone is NOT evidence of successful payment.</strong> An Owner Admin must independently verify the actual bank credit in the official merchant bank statement and match Receiving Bank Account, Exact Amount, 12-digit UTR, and Bank Credit Reference. Approving payment sets <code>Payment = VERIFIED</code> and <code>Order = AWAITING_CONFIRMATION</code> (never directly to packing or shipping).
      </Notice>

      {!isLive && (
        <Notice title="Payment data unavailable">
          Connect the local FastAPI server and private Supabase Storage to load payment proofs. No sample payments are shown and approvals remain backend-only.
        </Notice>
      )}
      {error && <Notice tone="error" title="Payment queue sync error">{error}</Notice>}

      <div className="stats-grid">
        <StatCard
          label="Pending Payment Queue"
          value={isLive ? (
            payments.filter((p) => ['SUBMITTED', 'UNDER_REVIEW'].includes(p.paymentStatus)).length
          ) : 'Unavailable'}
          subtitle="Requires bank check"
        />
        <StatCard
          label="Verified Bank Credits"
          value={isLive ? payments.filter((p) => p.paymentStatus === 'VERIFIED').length : 'Unavailable'}
          subtitle="Matched with bank statement"
        />
        <StatCard
          label="Rejected / Mismatched"
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
          <label htmlFor="payment-search">Search Order Number, UTR, Customer, or Bank Ref</label>
          <input
            id="payment-search"
            type="search"
            className="input"
            placeholder="Order number, 12-digit UTR, or bank reference"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="customer-filter-chips" aria-label="Filter payments by status">
          {PAYMENT_FILTER_OPTIONS.map((status) => (
            <button
              key={status}
              type="button"
              className={`chip${statusFilter === status ? ' chip--active' : ''}`}
              aria-pressed={statusFilter === status}
              onClick={() => setStatusFilter(status)}
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
          <div className="customer-table-scroll" role="region" aria-label="Payment verification queue" tabIndex={0}>
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Order Number</th>
                  <th scope="col">Customer</th>
                  <th scope="col">Expected Amount</th>
                  <th scope="col">Submitted UTR</th>
                  <th scope="col">Screenshot Proof</th>
                  <th scope="col">Submission Date</th>
                  <th scope="col">Bank Credit Ref</th>
                  <th scope="col">Payment Status</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredPayments.map((payment) => (
                  <tr key={payment.id}>
                    <td>
                      <strong>{payment.orderNumber}</strong>
                      <p className="text-small text-secondary">Order: {payment.orderStatus}</p>
                    </td>
                    <td>
                      <strong>{payment.customerName}</strong>
                      <p className="text-small text-secondary">{payment.customerPhone}</p>
                    </td>
                    <td><strong>{formatINR(payment.expectedAmount)}</strong></td>
                    <td><code>{payment.submittedUtr}</code></td>
                    <td>
                      <span className="badge badge--outline">Private Bucket</span>
                    </td>
                    <td className="text-small">{payment.submissionDate}</td>
                    <td className="text-small">
                      {payment.bankCredit?.bankCreditReference ? (
                        <code>{payment.bankCredit.bankCreditReference}</code>
                      ) : (
                        <span className="text-secondary">Unverified</span>
                      )}
                    </td>
                    <td><StatusBadge status={payment.paymentStatus} kind="payment" /></td>
                    <td>
                      <button
                        type="button"
                        className="btn btn--primary btn--sm"
                        onClick={() => openPaymentInspector(payment)}
                      >
                        {payment.paymentStatus === 'VERIFIED' ? 'View Audit' : 'Verify Credit'}
                      </button>
                    </td>
                  </tr>
                ))}
                {filteredPayments.length === 0 && (
                  <tr>
                    <td colSpan={9} className="text-secondary">
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
            ? `Verify Payment — ${selectedPayment.orderNumber}`
            : 'Payment Verification'
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
              <Notice tone="error" title="Verification Check Blocked">
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
                <dt>Customer-Submitted UTR</dt>
                <dd><code>{selectedPayment.submittedUtr}</code></dd>
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
                <dd>{selectedPayment.submissionDate}</dd>
              </div>
            </dl>

            {/* Private Screenshot Section */}
            <h3 style={{ fontSize: 18, marginBottom: 8 }}>
              Customer Payment Screenshot (Private Storage)
            </h3>
            <div style={{ marginBottom: 20 }}>
              <ImagePreview
                src={selectedPayment.signedScreenshotUrl}
                alt={`Payment screenshot for ${selectedPayment.orderNumber}`}
                privateStoragePath={selectedPayment.privateScreenshotPath}
                caption="Reminder: A screenshot alone is NOT proof of payment. Always check your bank statement."
              />
            </div>

            {/* Independent Bank Credit Matching Form */}
            <section
              className="card card--tinted"
              style={{ marginBottom: 20 }}
              aria-labelledby="bank-credit-form-heading"
            >
              <h3 id="bank-credit-form-heading" style={{ fontSize: 18, marginBottom: 6 }}>
                Check Matching Bank Credit
              </h3>
              <p className="text-small text-secondary" style={{ marginBottom: 14 }}>
                Record the actual bank statement details to verify settlement. Duplicate UTRs and duplicate bank credit references are rejected by FastAPI.
              </p>

              <div className="form-row">
                <div>
                  <label htmlFor="verify-bank-account">Receiving Bank Account</label>
                  <input
                    id="verify-bank-account"
                    className="input"
                    value={receivingBankAccount}
                    onChange={(e) => setReceivingBankAccount(e.target.value)}
                    disabled={selectedPayment.paymentStatus !== 'UNDER_REVIEW' || busy}
                  />
                </div>
                <div>
                  <label htmlFor="verify-tx-status">Bank Transaction Status</label>
                  <select
                    id="verify-tx-status"
                    className="input"
                    value={transactionStatus}
                    onChange={(e) =>
                      setTransactionStatus(e.target.value as 'CREDITED' | 'MISMATCH')
                    }
                    disabled={selectedPayment.paymentStatus !== 'UNDER_REVIEW' || busy}
                  >
                    <option value="CREDITED">CREDITED (Settled in bank)</option>
                    <option value="MISMATCH">MISMATCH / NOT FOUND</option>
                  </select>
                </div>
              </div>

              <div className="form-row">
                <div>
                  <label htmlFor="verify-utr">Verified 12-Digit Bank UTR</label>
                  <input
                    id="verify-utr"
                    className="input"
                    maxLength={12}
                    placeholder="12-digit UTR from bank statement"
                    value={verifiedUtrInput}
                    onChange={(e) => setVerifiedUtrInput(e.target.value.replace(/\D/g, ''))}
                    disabled={selectedPayment.paymentStatus !== 'UNDER_REVIEW' || busy}
                  />
                </div>
                <div>
                  <label htmlFor="verify-amount">Verified Bank Credit Amount (₹)</label>
                  <input
                    id="verify-amount"
                    type="number"
                    step="0.01"
                    className="input"
                    placeholder="Exact amount credited"
                    value={verifiedAmountInput}
                    onChange={(e) => setVerifiedAmountInput(e.target.value)}
                    disabled={selectedPayment.paymentStatus !== 'UNDER_REVIEW' || busy}
                  />
                </div>
              </div>

              <div style={{ marginBottom: 14 }}>
                <label htmlFor="verify-bank-ref">Bank Credit Reference / Statement Entry ID</label>
                <input
                  id="verify-bank-ref"
                  className="input"
                  placeholder="e.g. AXIS-CR-20261015-8841"
                  value={bankCreditRefInput}
                  onChange={(e) => setBankCreditRefInput(e.target.value)}
                  disabled={selectedPayment.paymentStatus !== 'UNDER_REVIEW' || busy}
                />
              </div>

              <div style={{ marginBottom: 14 }}>
                <label htmlFor="verify-notes">Admin Verification Notes (Optional)</label>
                <input
                  id="verify-notes"
                  className="input"
                  placeholder="Optional audit note…"
                  value={verificationNotes}
                  onChange={(e) => setVerificationNotes(e.target.value)}
                  disabled={selectedPayment.paymentStatus !== 'UNDER_REVIEW' || busy}
                />
              </div>

              {selectedPayment.paymentStatus === 'SUBMITTED' ? (
                <button
                  type="button"
                  className="btn btn--primary btn--full"
                  disabled={busy}
                  onClick={handleStartPaymentReview}
                >
                  {busy ? 'Starting review via FastAPI…' : 'Start Independent Bank Review'}
                </button>
              ) : selectedPayment.paymentStatus === 'UNDER_REVIEW' ? (
                <button
                  type="button"
                  className="btn btn--primary btn--full"
                  disabled={busy}
                  onClick={handleApprovePayment}
                >
                  {busy
                    ? 'Verifying with FastAPI…'
                    : 'Approve Payment (Sets Order → Awaiting Confirmation)'}
                </button>
              ) : selectedPayment.paymentStatus === 'VERIFIED' ? (
                <Notice tone="success" title="Payment Verified">
                  Verified by {selectedPayment.bankCredit?.verifiedByAdmin ?? 'Owner Admin'} on{' '}
                  {selectedPayment.bankCredit?.verifiedAt}. Bank Credit Ref:{' '}
                  <code>{selectedPayment.bankCredit?.bankCreditReference}</code>.
                </Notice>
              ) : (
                <Notice tone="warning" title="Payment action unavailable">
                  This payment is no longer eligible for bank-credit approval.
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
                  placeholder="e.g. UTR 428910349912 not found in Axis Bank statement, or screenshot is unreadable…"
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
