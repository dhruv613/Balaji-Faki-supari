import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import Notice from '../../../components/common/Notice';
import { env } from '../../../lib/env';
import { formatINR, getErrorMessage } from '../../../lib/api';
import {
  getAdminRefunds,
  approveAdminRefund,
  recordAdminRefundTransfer,
} from '../api';
import type { AdminRefundRecord, AdminRefundStatus } from '../types';
import {
  REFUND_STATUS_LABELS,
  validateRefundCompletion,
} from '../lib/orderStateMachine';
import {
  StatCard,
  StatusBadge,
  DetailDrawer,
  LoadingSkeleton,
  useAdminToast,
} from '../components';

const REFUND_FILTER_OPTIONS: Array<AdminRefundStatus | 'ALL'> = [
  'ALL',
  'PENDING',
  'APPROVED',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
  'NOT_REQUIRED',
];

export default function AdminRefundsPage() {
  const [searchParams] = useSearchParams();
  const { showToast } = useAdminToast();

  const initialStatus = searchParams.get('status') as AdminRefundStatus | null;

  const [refunds, setRefunds] = useState<AdminRefundRecord[]>([]);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<AdminRefundStatus | 'ALL'>(
    initialStatus && REFUND_FILTER_OPTIONS.includes(initialStatus) ? initialStatus : 'ALL',
  );
  const [selectedRefund, setSelectedRefund] = useState<AdminRefundRecord | null>(null);

  // Verified transfer form inputs
  const [refundTxRef, setRefundTxRef] = useState('');
  const [refundBankAccount, setRefundBankAccount] = useState('');
  const [refundDate, setRefundDate] = useState('');
  const [refundEvidence, setRefundEvidence] = useState<'BANK_TRANSFER' | 'LOCAL_TEST'>('BANK_TRANSFER');
  const [settlementChecked, setSettlementChecked] = useState(false);
  const [verifiedAmountInput, setVerifiedAmountInput] = useState('');
  const [refundNotes, setRefundNotes] = useState('');
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
    getAdminRefunds({
      search: query || undefined,
      status: statusFilter,
    })
      .then((res) => {
        if (active) {
          setRefunds(res.items);
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

  function openRefundDrawer(record: AdminRefundRecord) {
    setSelectedRefund(record);
    setRefundTxRef(record.refundTransactionReference ?? '');
    setRefundBankAccount(record.refundBankAccount ?? '');
    setRefundDate(record.refundDate ?? new Date().toISOString().slice(0, 10));
    setRefundEvidence('BANK_TRANSFER');
    setSettlementChecked(false);
    setVerifiedAmountInput(
      record.refundAmount !== null ? String(record.refundAmount) : '',
    );
    setRefundNotes(record.notes ?? '');
    setValidationError('');
  }

  const filtered = refunds.filter((r) => {
    if (statusFilter !== 'ALL' && r.refundStatus !== statusFilter) return false;
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return `${r.orderNumber} ${r.customerName} ${r.originalPaymentUtr} ${r.refundTransactionReference ?? ''}`
      .toLowerCase()
      .includes(q);
  });

  async function handleApproveRefund() {
    if (!selectedRefund) return;
    setValidationError('');

    if (selectedRefund.refundStatus !== 'PENDING') {
      setValidationError('Only PENDING refunds can be approved.');
      return;
    }

    if (!env.apiBaseUrl) {
      setValidationError(
        'Integration Pending: FastAPI (POST /api/admin/refunds/{id}/approve) is not connected. Refund approvals require backend authorization.',
      );
      showToast('Refund approval blocked: FastAPI backend is not connected.', 'warning');
      return;
    }

    setBusy(true);
    try {
      const updated = await approveAdminRefund(selectedRefund.id, {
        notes: refundNotes.trim() || undefined,
      });
      setRefunds((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
      setSelectedRefund(updated);
      showToast(`Refund for ${updated.orderNumber} approved for bank transfer.`, 'success');
    } catch (err) {
      setValidationError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleRecordCompletedTransfer(e: FormEvent) {
    e.preventDefault();
    if (!selectedRefund) return;
    setValidationError('');

    const transferPayload = {
      refundTransactionReference: refundTxRef.trim(),
      refundBankAccount: refundBankAccount.trim(),
      refundDate: refundDate.trim(),
      verifiedAmount: Number(verifiedAmountInput),
      evidenceKind: refundEvidence,
      transferSettlementChecked: refundEvidence === 'BANK_TRANSFER' ? settlementChecked : undefined,
      notes: refundNotes.trim() || undefined,
    };

    if (refundEvidence === 'BANK_TRANSFER' && !settlementChecked) {
      setValidationError('Confirm that the refund transfer is visible as settled on the actual bank statement. A typed reference alone is not proof.');
      return;
    }
    if (refundEvidence === 'LOCAL_TEST' && !transferPayload.refundTransactionReference.toUpperCase().startsWith('TEST-')) {
      setValidationError('LOCAL TEST evidence must use a reference that starts with TEST-.');
      return;
    }

    const check = validateRefundCompletion({
      currentRefundStatus: selectedRefund.refundStatus,
      expectedRefundAmount: selectedRefund.refundAmount,
      transferInput: transferPayload,
    });

    if (!check.allowed) {
      setValidationError(
        check.reason ?? 'Cannot mark refund COMPLETED without verified bank transfer details.',
      );
      return;
    }

    if (!env.apiBaseUrl) {
      setValidationError(
        'Integration Pending: FastAPI (POST /api/admin/refunds/{id}/record-transfer) is not connected. Simulated refund completion is disabled.',
      );
      showToast('Refund completion blocked: FastAPI backend is not connected.', 'warning');
      return;
    }

    setBusy(true);
    try {
      const updated = await recordAdminRefundTransfer(selectedRefund.id, transferPayload);
      setRefunds((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
      setSelectedRefund(updated);
      showToast(`Recorded verified refund transfer for ${updated.orderNumber}.`, 'success');
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
          <h1 className="page__header">Cancellations &amp; Refunds</h1>
          <p className="page__subtitle">
            Manage order cancellation requests and record bank-verified refund transfers.
          </p>
        </div>
        <span className="badge badge--dark">Separate Refund Ledger</span>
      </div>

      <Notice tone="warning" title="Manual Refund Verification Policy">
        <strong>A refund cannot be marked COMPLETED merely by clicking a button.</strong> Refunds are stored separately from original payment records. First approve the eligible refund request, execute the bank transfer, and then record the verified Refund Transaction Reference, Source Bank Account, and Transfer Date.
      </Notice>

      {!isLive && (
        <Notice title="Refund data unavailable">
          Connect the local FastAPI server to load eligible refunds. No sample refund records are shown.
        </Notice>
      )}
      {error && <Notice tone="error" title="Refunds sync error">{error}</Notice>}

      <div className="stats-grid">
        <StatCard label="Total Refund Records" value={isLive ? refunds.length : 'Unavailable'} />
        <StatCard
          label="Pending Refunds"
          value={isLive ? refunds.filter((r) => r.refundStatus === 'PENDING').length : 'Unavailable'}
          subtitle="Awaiting approval"
        />
        <StatCard
          label="Approved / Processing"
          value={isLive ? (
            refunds.filter((r) => ['APPROVED', 'PROCESSING'].includes(r.refundStatus)).length
          ) : 'Unavailable'}
          subtitle="Awaiting bank transfer ref"
        />
        <StatCard
          label="Completed Refunds"
          value={isLive ? refunds.filter((r) => r.refundStatus === 'COMPLETED').length : 'Unavailable'}
          subtitle="Bank transfer verified"
        />
      </div>

      {/* Search & Filters */}
      <div className="card card--tinted customer-filters">
        <div style={{ flex: '2 1 260px' }}>
          <label htmlFor="refund-search">
            Search Order ID, Customer, Original UTR, or Refund Ref
          </label>
          <input
            id="refund-search"
            type="search"
            className="input"
            placeholder="Order ID, customer, UTR, or refund reference"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="customer-filter-chips" aria-label="Refund status filters">
          {REFUND_FILTER_OPTIONS.map((st) => (
            <button
              key={st}
              type="button"
              className={`chip${statusFilter === st ? ' chip--active' : ''}`}
              aria-pressed={statusFilter === st}
              onClick={() => setStatusFilter(st)}
            >
              {st === 'ALL' ? 'All' : REFUND_STATUS_LABELS[st]}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <LoadingSkeleton rows={4} />
      ) : (
        <div className="card">
          <div className="customer-table-scroll" role="region" aria-label="Refunds table" tabIndex={0}>
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Order ID</th>
                  <th scope="col">Customer</th>
                  <th scope="col">Refund Amount</th>
                  <th scope="col">Cancellation Reason</th>
                  <th scope="col">Original Payment UTR</th>
                  <th scope="col">Refund Bank Reference</th>
                  <th scope="col">Refund Date</th>
                  <th scope="col">Refund Status</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <strong>{item.orderNumber}</strong>
                      <p className="text-small text-secondary">{item.cancelledAt}</p>
                    </td>
                    <td>
                      <strong>{item.customerName}</strong>
                      <p className="text-small text-secondary">{item.customerPhone}</p>
                    </td>
                    <td><strong>{formatINR(item.refundAmount)}</strong></td>
                    <td className="text-small" style={{ maxWidth: 240 }}>{item.refundReason}</td>
                    <td><code>{item.originalPaymentUtr}</code></td>
                    <td>
                      {item.refundTransactionReference ? (
                        <code>{item.refundTransactionReference}</code>
                      ) : (
                        <span className="text-secondary text-small">Not transferred</span>
                      )}
                    </td>
                    <td className="text-small">{item.refundDate ?? '—'}</td>
                    <td><StatusBadge status={item.refundStatus} kind="refund" /></td>
                    <td>
                      <button
                        type="button"
                        className="btn btn--dark btn--sm"
                        onClick={() => openRefundDrawer(item)}
                      >
                        {item.refundStatus === 'COMPLETED' ? 'View Audit' : 'Process Refund'}
                      </button>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={9} className="text-secondary">
                      No cancellation or refund records match these filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Refund Detail & Verification Drawer */}
      <DetailDrawer
        open={selectedRefund !== null}
        title={
          selectedRefund
            ? `Refund Record — ${selectedRefund.orderNumber}`
            : 'Refund Details'
        }
        subtitle={
          selectedRefund
            ? `${selectedRefund.customerName} · Cancelled ${selectedRefund.cancelledAt}`
            : undefined
        }
        onClose={() => setSelectedRefund(null)}
      >
        {selectedRefund && (
          <div>
            {validationError && (
              <Notice tone="error" title="Refund Verification Blocked">
                {validationError}
              </Notice>
            )}

            <dl className="admin-kv-grid">
              <div className="admin-kv-item">
                <dt>Order ID</dt>
                <dd>{selectedRefund.orderNumber}</dd>
              </div>
              <div className="admin-kv-item">
                <dt>Refund Status</dt>
                <dd><StatusBadge status={selectedRefund.refundStatus} kind="refund" /></dd>
              </div>
              <div className="admin-kv-item">
                <dt>Refund Amount</dt>
                <dd>{formatINR(selectedRefund.refundAmount)}</dd>
              </div>
              <div className="admin-kv-item">
                <dt>Original Payment UTR</dt>
                <dd><code>{selectedRefund.originalPaymentUtr}</code></dd>
              </div>
              <div className="admin-kv-item" style={{ gridColumn: '1 / -1' }}>
                <dt>Cancellation &amp; Refund Reason</dt>
                <dd>{selectedRefund.refundReason}</dd>
              </div>
            </dl>

            {/* Step 1: Approve Refund */}
            {selectedRefund.refundStatus === 'PENDING' && (
              <section className="card card--tinted" style={{ marginBottom: 20 }}>
                <h3 style={{ fontSize: 18, marginBottom: 6 }}>
                  Step 1 — Approve Refund Eligibility
                </h3>
                <p className="text-small text-secondary" style={{ marginBottom: 12 }}>
                  Confirm that the original payment UTR (<code>{selectedRefund.originalPaymentUtr}</code>) was verified in the bank account and the order is eligible for refund.
                </p>
                <button
                  type="button"
                  className="btn btn--primary"
                  disabled={busy}
                  onClick={handleApproveRefund}
                >
                  Approve Refund Request (Sets Status → APPROVED)
                </button>
              </section>
            )}

            {/* Step 2: Record Verified Bank Transfer */}
            <form className="card" onSubmit={handleRecordCompletedTransfer}>
              <h3 style={{ fontSize: 18, marginBottom: 6 }}>
                Step 2 — Record Verified Bank Refund Transfer
              </h3>
              <p className="text-small text-secondary" style={{ marginBottom: 14 }}>
                A refund can only be marked <strong>COMPLETED</strong> after recording the actual bank transfer reference and verified transfer details.
              </p>

              <div className="form-row">
                <div>
                  <label htmlFor="ref-tx-id">Refund Bank Transaction Reference / UTR</label>
                  <input
                    id="ref-tx-id"
                    className="input"
                    placeholder="e.g. AXIS-REF-20261017-9012"
                    value={refundTxRef}
                    onChange={(e) => setRefundTxRef(e.target.value)}
                    disabled={selectedRefund.refundStatus === 'COMPLETED' || busy}
                    required
                  />
                </div>
                <div>
                  <label htmlFor="ref-date">Refund Transfer Date</label>
                  <input
                    id="ref-date"
                    type="date"
                    className="input"
                    value={refundDate}
                    onChange={(e) => setRefundDate(e.target.value)}
                    disabled={selectedRefund.refundStatus === 'COMPLETED' || busy}
                    required
                  />
                </div>
              </div>

              <div className="form-row">
                <div>
                  <label htmlFor="ref-bank-acc">Source Merchant Bank Account</label>
                  <input
                    id="ref-bank-acc"
                    className="input"
                    value={refundBankAccount}
                    onChange={(e) => setRefundBankAccount(e.target.value)}
                    disabled={selectedRefund.refundStatus === 'COMPLETED' || busy}
                    required
                  />
                </div>
                <div>
                  <label htmlFor="ref-amount">Verified Transferred Amount (₹)</label>
                  <input
                    id="ref-amount"
                    type="number"
                    step="0.01"
                    className="input"
                    placeholder="Exact amount refunded"
                    value={verifiedAmountInput}
                    onChange={(e) => setVerifiedAmountInput(e.target.value)}
                    disabled={selectedRefund.refundStatus === 'COMPLETED' || busy}
                    required
                  />
                </div>
              </div>

              <div style={{ marginBottom: 14 }}>
                <label htmlFor="ref-notes">Audit Notes</label>
                <textarea
                  id="ref-notes"
                  className="input"
                  value={refundNotes}
                  onChange={(e) => setRefundNotes(e.target.value)}
                  disabled={selectedRefund.refundStatus === 'COMPLETED' || busy}
                />
              </div>

              {selectedRefund.refundStatus !== 'COMPLETED' && (
                <fieldset style={{ marginBottom: 14 }} disabled={busy}>
                  <legend>Evidence that the transfer settled</legend>
                  <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontWeight: 400 }}>
                    <input type="radio" name="refund-evidence" checked={refundEvidence === 'BANK_TRANSFER'} onChange={() => setRefundEvidence('BANK_TRANSFER')} />
                    <span>Real bank transfer, visible as settled on the bank statement.</span>
                  </label>
                  {!env.isProd && (
                    <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontWeight: 400 }}>
                      <input type="radio" name="refund-evidence" checked={refundEvidence === 'LOCAL_TEST'} onChange={() => setRefundEvidence('LOCAL_TEST')} />
                      <span>LOCAL TEST evidence (development only; reference must start with TEST-).</span>
                    </label>
                  )}
                  {refundEvidence === 'BANK_TRANSFER' ? (
                    <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontWeight: 600, marginTop: 8 }}>
                      <input type="checkbox" checked={settlementChecked} onChange={(e) => setSettlementChecked(e.target.checked)} />
                      <span>I found this refund transfer settled on the actual bank statement. A typed reference alone is not proof.</span>
                    </label>
                  ) : (
                    <Notice tone="warning" title="TEST evidence">Recorded as LOCAL TEST evidence; the server refuses it outside local development.</Notice>
                  )}
                </fieldset>
              )}

              {selectedRefund.refundStatus !== 'COMPLETED' ? (
                <button type="submit" className="btn btn--dark btn--full" disabled={busy}>
                  {busy ? 'Recording Transfer…' : 'Verify & Mark Refund COMPLETED'}
                </button>
              ) : (
                <Notice tone="success" title="Refund Completed & Verified">
                  Bank Reference: <code>{selectedRefund.refundTransactionReference}</code> · Date:{' '}
                  {selectedRefund.refundDate} · Completed by {selectedRefund.completedBy}.
                </Notice>
              )}
            </form>
          </div>
        )}
      </DetailDrawer>
    </div>
  );
}
