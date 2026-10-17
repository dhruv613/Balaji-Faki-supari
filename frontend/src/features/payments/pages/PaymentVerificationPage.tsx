import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import OrderStepper from '../../../components/common/OrderStepper';
import Notice from '../../../components/common/Notice';
import NoActiveOrder from '../../../components/common/NoActiveOrder';
import { useOrder, useOrderDispatch, buildSummary } from '../../../context/OrderContext';
import { formatINR, getErrorMessage, isNetworkError } from '../../../lib/api';
import { env } from '../../../lib/env';
import { getPaymentStatus, maskUtr, isPaymentConfirmed } from '../api/paymentsApi';
import type { PaymentStatusResponse } from '../../../types/orders';

/** How often to re-check while the payment is being verified. */
const POLL_INTERVAL_MS = 15_000;

type CheckError = { kind: 'offline' | 'server'; message: string } | null;

export default function PaymentVerificationPage() {
  const state = useOrder();
  const dispatch = useOrderDispatch();
  const navigate = useNavigate();
  const summary = buildSummary(state);

  const [checking, setChecking] = useState(false);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [serverInfo, setServerInfo] = useState<PaymentStatusResponse | null>(null);
  const [error, setError] = useState<CheckError>(null);
  const inFlight = useRef(false);
  const activeOrderId = useRef(state.orderId);
  activeOrderId.current = state.orderId;
  useEffect(() => {
    activeOrderId.current = state.orderId;
    return () => { activeOrderId.current = ''; };
  }, [state.orderId]);

  const orderId = state.orderId;
  const status = state.paymentStatus;

  const checkStatus = useCallback(async () => {
    if (!orderId || inFlight.current) return;
    inFlight.current = true;
    setChecking(true);
    try {
      const res = await getPaymentStatus(orderId);
      if (activeOrderId.current !== orderId) return;
      setServerInfo(res);
      setError(null);
      setLastChecked(new Date());
      dispatch({ type: 'SET_PAYMENT_STATUS', payload: res.status });
      // Only the server can declare a payment verified.
      if (isPaymentConfirmed(res)) {
        navigate('/order/confirmation', { replace: true });
      }
    } catch (err) {
      if (activeOrderId.current !== orderId) return;
      setError({
        kind: isNetworkError(err) ? 'offline' : 'server',
        message: getErrorMessage(err),
      });
    } finally {
      inFlight.current = false;
      if (activeOrderId.current === orderId) setChecking(false);
    }
  }, [orderId, dispatch, navigate]);

  /* Check on arrival, then poll while the payment is still being verified. */
  useEffect(() => {
    if (!orderId || !state.serverOrder || status === 'failed') return;
    void checkStatus();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void checkStatus();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
    // Run once per order; polling stops automatically when status changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, status, Boolean(state.serverOrder), checkStatus]);

  /* ----- Guards ----- */
  if (!orderId) {
    return (
      <div className="wrapper">
        <OrderStepper currentStep={4} />
        <NoActiveOrder message="There's no payment to verify yet. Place an order and submit your UTR to see its verification status here." />
      </div>
    );
  }

  if (!state.serverOrder) return <div className="wrapper"><OrderStepper currentStep={4} /><Notice title="Recover your existing order" actions={<button className="btn" onClick={() => dispatch({ type: 'RETRY_ORDER' })}>Retry loading order</button>}>{state.orderLoadStatus || 'Please sign in through My Orders to reload your existing order.'} Please do not pay again.</Notice></div>;

  // Payment details were never submitted — send the customer back to the QR step.
  if (serverInfo?.status === 'pending') {
    return <Navigate to="/order/payment" replace />;
  }

  const failed = status === 'failed';
  const orderNumber = serverInfo?.orderNumber ?? state.orderNumber;
  const utrDisplay = serverInfo?.utrMasked ?? (state.utrNumber ? maskUtr(state.utrNumber) : '—');
  const supportHref = `https://wa.me/${env.supportWhatsApp}?text=${encodeURIComponent(
    `Hello, I need help with payment verification for order ${orderNumber}. UTR: ${utrDisplay}`,
  )}`;

  return (
    <div className="wrapper">
      <OrderStepper currentStep={4} />

      <div className="verification-panel">
        {error?.kind === 'offline' && (
          <Notice tone="warning" title="Couldn't check the latest status" id="status-offline-notice">
            The verification server isn't reachable right now. Your submission is not lost —
            please don't pay again. Try refreshing in a moment.
          </Notice>
        )}
        {error?.kind === 'server' && (
          <Notice tone="error" title="Couldn't check the latest status" id="status-error-notice">
            {error.message}
          </Notice>
        )}

        <div className="card">
          <div className={`circle-icon ${failed ? 'circle-icon--failed' : 'circle-icon--pending'}`}>
            {failed ? (
              <svg className="icon icon--lg" viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            ) : (
              <svg className="icon icon--lg" viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
            )}
          </div>

          {failed ? (
            <>
              <h1 style={{ marginBottom: 8 }}>We couldn't verify your payment</h1>
              <p className="text-secondary" style={{ maxWidth: 460, margin: '0 auto 24px' }}>
                {serverInfo?.message ??
                  "We couldn't match this UTR with a credit in our account. Please contact support — don't pay again until we've checked."}
              </p>
            </>
          ) : (
            <>
              <h1 style={{ marginBottom: 8 }}>Verifying your payment</h1>
              <p className="text-secondary" style={{ maxWidth: 460, margin: '0 auto 24px' }}>
                We're matching your UPI transaction with our account. This page
                updates automatically — please don't pay again.
              </p>
            </>
          )}

          {/* Details */}
          <dl style={{ textAlign: 'left', maxWidth: 480, margin: '0 auto' }}>
            <div className="summary-row">
              <dt>Order</dt>
              <dd style={{ margin: 0 }}><strong>{orderNumber}</strong></dd>
            </div>
            <div className="summary-row">
              <dt>Amount</dt>
              <dd style={{ margin: 0 }}><strong>{formatINR(summary.total)}</strong></dd>
            </div>
            <div className="summary-row">
              <dt>UPI transaction ID</dt>
              <dd style={{ margin: 0 }}><strong>{utrDisplay}</strong></dd>
            </div>
            <div className="summary-row">
              <dt>Status</dt>
              <dd style={{ margin: 0 }} aria-live="polite">
                {failed ? (
                  <span className="badge badge--failed">Not verified</span>
                ) : (
                  <span className="badge">
                    <svg className="icon icon--sm" viewBox="0 0 24 24" aria-hidden="true">
                      <circle cx="12" cy="12" r="10" />
                      <polyline points="12 6 12 12 16 14" />
                    </svg>
                    Pending verification
                  </span>
                )}
              </dd>
            </div>
          </dl>

          {lastChecked && (
            <p className="text-secondary text-small" style={{ marginTop: 16 }}>
              Last checked at {lastChecked.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
            </p>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'center', marginTop: 32 }}>
            <button
              type="button"
              className="btn btn--primary"
              id="refresh-status-btn"
              onClick={() => void checkStatus()}
              disabled={checking}
              aria-busy={checking}
            >
              {checking ? (
                <>
                  <span className="spinner" aria-hidden="true" /> Checking…
                </>
              ) : (
                'Refresh status'
              )}
            </button>
            <a
              className="btn"
              id="contact-support-btn"
              href={supportHref}
              target="_blank"
              rel="noopener noreferrer"
            >
              Contact support
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
