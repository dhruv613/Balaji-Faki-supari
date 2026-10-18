import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import OrderStepper from '../../../components/common/OrderStepper';
import Notice from '../../../components/common/Notice';
import NoActiveOrder from '../../../components/common/NoActiveOrder';
import { useOrder, useOrderDispatch } from '../../../context/OrderContext';
import { formatINR, getErrorMessage, isNetworkError } from '../../../lib/api';
import { useSession } from '../../../lib/supabase';
import EmailSignIn from '../../../components/common/EmailSignIn';
import {
  SCREENSHOT_ACCEPT,
  getPaymentStatus,
  isPaymentSubmittedOrVerified,
  submitPayment,
  validateScreenshot,
  validateUtr,
} from '../api/paymentsApi';

function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

type SubmitError = { kind: 'offline' | 'server'; message: string } | null;

export default function QRPaymentPage() {
  const state = useOrder();
  const dispatch = useOrderDispatch();
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);

  const { session, loading: authLoading } = useSession();
  const order = state.serverOrder;
  const payment = order?.payment;
  const scope = `${order?.id ?? ''}:${session?.user.id ?? ''}`;
  const activeScope = useRef(scope);
  activeScope.current = scope;
  useEffect(() => { activeScope.current = scope; return () => { activeScope.current = ''; }; }, [scope]);

  const [copied, setCopied] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [touched, setTouched] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<SubmitError>(null);

  const deadline = payment?.expiresAt ? Date.parse(payment.expiresAt) : null;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (deadline === null) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [deadline]);
  const remaining = deadline === null ? null : deadline - now;
  const expired = remaining !== null && remaining <= 0;

  /* ----- Guards ----- */
  if (state.orderId && !order) return <div className="wrapper"><OrderStepper currentStep={3} />{!session ? <EmailSignIn /> : <Notice title="Recover your existing order" actions={<button className="btn" onClick={() => dispatch({ type: 'RETRY_ORDER' })}>Retry loading order</button>}>{state.orderLoadStatus || 'Checking your existing order…'} Please do not pay again or create a replacement order until its status is confirmed.</Notice>}</div>;
  if (!order) {
    return (
      <div className="wrapper">
        <OrderStepper currentStep={3} />
        <NoActiveOrder message="There's no order to pay for yet. Payment opens only after our server creates your order and confirms the exact amount." />
      </div>
    );
  }

  if (authLoading) return <div className="wrapper"><OrderStepper currentStep={3} /><p role="status">Checking your sign-in…</p></div>;
  if (!session) return <div className="wrapper"><OrderStepper currentStep={3} /><EmailSignIn /></div>;

  // Already submitted — never allow a second submission from this screen.
  if (isPaymentSubmittedOrVerified(state.paymentStatus)) {
    return <Navigate to="/order/verification" replace />;
  }

  const amount = payment?.amount ?? order.total;
  const upiId = payment?.upiId ?? '';
  const payeeName = payment?.payeeName ?? '';
  const qrImageUrl = payment?.qrImageUrl;
  if (!payment) return <div className="wrapper"><OrderStepper currentStep={3} /><NoActiveOrder title="Payment instructions unavailable" message="The server has not issued payment instructions for this order. Please contact the store before paying." /></div>;

  const utrError = touched ? validateUtr(state.utrNumber) : null;
  const screenshotError = touched ? fileError ?? validateScreenshot(state.screenshotFile) : fileError;

  async function handleCopyUPI() {
    try {
      await navigator.clipboard.writeText(upiId);
      setCopied('copied');
    } catch {
      setCopied('failed');
    }
    window.setTimeout(() => setCopied('idle'), 2000);
  }

  function handleScreenshot(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    e.target.value = ''; // allow re-selecting the same file
    if (!file) return;
    const err = validateScreenshot(file);
    setFileError(err);
    if (err) {
      dispatch({ type: 'SET_SCREENSHOT', payload: { file: null, preview: '' } });
      return;
    }
    dispatch({
      type: 'SET_SCREENSHOT',
      payload: { file, preview: URL.createObjectURL(file) },
    });
  }

  async function handleSubmit() {
    if (submitting) return;
    setTouched(true);
    setSubmitError(null);

    const utrMsg = validateUtr(state.utrNumber);
    const fileMsg = validateScreenshot(state.screenshotFile);
    if (utrMsg) {
      document.getElementById('utr-input')?.focus();
      return;
    }
    if (fileMsg || !state.screenshotFile) {
      document.getElementById('upload-screenshot-btn')?.focus();
      return;
    }

    setSubmitting(true);
    try {
      // FastAPI stores the screenshot in private Supabase Storage and sets
      // Payment = SUBMITTED and Order = PAYMENT_REVIEW. This is NOT verified payment.
      const result = await submitPayment(order!.id, {
        utrNumber: state.utrNumber.trim(),
        screenshot: state.screenshotFile,
      });
      if (activeScope.current !== scope) return;
      dispatch({ type: 'SET_PAYMENT_STATUS', payload: result.paymentStatus });
      navigate('/order/verification');
    } catch (err) {
      if (activeScope.current !== scope) return;
      if (isNetworkError(err)) {
        try {
          const currentStatus = await getPaymentStatus(order!.id);
          if (activeScope.current !== scope) return;
          if (isPaymentSubmittedOrVerified(currentStatus.status)) {
            dispatch({ type: 'SET_PAYMENT_STATUS', payload: currentStatus.status });
            navigate('/order/verification');
            return;
          }
        } catch {
          // Fall through to offline notice without encouraging duplicate payment
        }
      }
      setSubmitError({
        kind: isNetworkError(err) ? 'offline' : 'server',
        message: getErrorMessage(err),
      });
    } finally {
      if (activeScope.current === scope) setSubmitting(false);
    }
  }

  return (
    <div className="wrapper">
      <OrderStepper currentStep={3} />

      <h1 className="page__header">Scan &amp; pay</h1>
      <p className="page__subtitle">
        Pay the exact amount using any UPI app, then confirm below.
      </p>

      {expired && (
        <Notice tone="warning" title="This payment window has expired" id="payment-expired-notice">
          If you have already paid, enter your UTR and screenshot below. If you haven't paid,
          please don't pay now. Contact the store to confirm the order's payment instructions.
        </Notice>
      )}

      {submitError?.kind === 'offline' && (
        <Notice tone="warning" title="Payment submission isn't connected" id="submit-offline-notice">
          We couldn't confirm whether the server received your payment details. Please don't pay again.
          Contact support with your UTR if the status remains unclear.
        </Notice>
      )}

      {submitError?.kind === 'server' && (
        <Notice tone="error" title="We couldn't submit your payment details" id="submit-error-notice">
          {submitError.message}
        </Notice>
      )}

      <div className="payment-layout">
        {/* ---- Left: QR code ---- */}
        <section
          className="two-col__main"

          aria-label="UPI QR code"
        >
          <div className="card" style={{ textAlign: 'center' }}>
            <div className="qr-box">
              {qrImageUrl && !expired ? (
                <img
                  src={qrImageUrl}
                  alt={`UPI QR code to pay ${payeeName}`}
                  width={280}
                  height={280}
                />
              ) : (
                <div className="qr-unavailable" role="img" aria-label="QR code not available">
                  <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
                    <rect x="3" y="3" width="7" height="7" />
                    <rect x="14" y="3" width="7" height="7" />
                    <rect x="3" y="14" width="7" height="7" />
                    <line x1="14" y1="14" x2="21" y2="21" />
                    <line x1="21" y1="14" x2="14" y2="21" />
                  </svg>
                  <span>
                    {expired ? 'The payment window has expired. Please contact the store before paying.' : 'The official QR is not available. Confirm payment instructions with the store before paying.'}
                  </span>
                </div>
              )}
            </div>

            <div className="qr-merchant" style={{ marginTop: 20 }}>
              <p className="qr-merchant__name">Pay to: {payeeName}</p>
              <p className="qr-merchant__upi">UPI ID: {upiId}</p>
            </div>

            <button
              type="button"
              className="btn btn--full"
              id="copy-upi-btn"
              disabled={expired}
              onClick={handleCopyUPI}
              style={{ marginTop: 12 }}
            >
              <svg className="icon icon--sm" viewBox="0 0 24 24" aria-hidden="true">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
              {copied === 'copied' ? 'Copied!' : copied === 'failed' ? 'Copy failed — select manually' : 'Copy UPI ID'}
            </button>
            <span className="sr-only" aria-live="polite">
              {copied === 'copied' ? 'UPI ID copied to clipboard' : ''}
            </span>

            <p className="text-secondary text-small" style={{ marginTop: 12 }}>
              Google Pay · PhonePe · Paytm · BHIM
            </p>
          </div>
        </section>

        {/* ---- Right: Payment details ---- */}
        <section className="two-col__side" aria-label="Payment details">
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 8, flexWrap: 'wrap' }}>
              <div>
                <p className="text-secondary text-small">Amount to pay</p>
                <p className="amount-display" id="amount-to-pay">{formatINR(amount)}</p>
                <p className="text-secondary text-small" style={{ marginTop: 4 }}>
                  Order {order.orderNumber}
                </p>
              </div>
              {remaining !== null && <span
                className={`payment-timer${expired ? ' payment-timer--expired' : ''}`}
                role="timer"
                aria-live="off"
              >
                <svg className="icon icon--sm" viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
                {expired ? 'Window expired' : `Pay within ${formatCountdown(remaining)}`}
              </span>}
            </div>

            <ol style={{ paddingLeft: 20, margin: '16px 0', color: 'var(--color-text-secondary)' }}>
              <li>Open any UPI app and scan this QR.</li>
              <li>Pay the exact amount shown.</li>
              <li>Enter your UPI transaction ID below.</li>
            </ol>

            <div style={{ marginBottom: 16 }}>
              <label htmlFor="utr-input"><strong>UPI transaction ID (UTR)</strong></label>
              <input
                id="utr-input"
                disabled={submitting}
                className={`input${utrError ? ' input--error' : ''}`}
                type="text"
                inputMode="numeric"
                autoComplete="off"
                maxLength={12}
                placeholder="12-digit transaction ID"
                value={state.utrNumber}
                aria-invalid={utrError ? true : undefined}
                aria-describedby={utrError ? 'utr-error' : undefined}
                onChange={(e) =>
                  dispatch({ type: 'SET_UTR', payload: e.target.value.replace(/\D/g, '').slice(0, 12) })
                }
              />
              {utrError && <p className="field-error" id="utr-error">{utrError}</p>}
            </div>

            {/* Screenshot upload (required) */}
            <input
              type="file"
              ref={fileRef}
              id="screenshot-input"
              accept={SCREENSHOT_ACCEPT.join(',')}
              style={{ display: 'none' }}
              onChange={handleScreenshot}
            />

            <button
              type="button"
              id="upload-screenshot-btn"
              disabled={submitting}
              className={`upload-area${screenshotError ? ' upload-area--error' : ''}${state.screenshotFile ? ' upload-area--filled' : ''}`}
              onClick={() => fileRef.current?.click()}
              aria-describedby={screenshotError ? 'screenshot-error' : undefined}
              style={{ width: '100%', marginBottom: screenshotError ? 4 : 16 }}
            >
              <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
                <rect x="3" y="3" width="7" height="7" />
                <rect x="14" y="3" width="7" height="7" />
                <rect x="3" y="14" width="7" height="7" />
                <rect x="14" y="14" width="7" height="7" />
              </svg>
              {state.screenshotFile ? 'Change payment screenshot' : 'Upload payment screenshot (required)'}
            </button>
            {screenshotError && (
              <p className="field-error" id="screenshot-error" style={{ marginBottom: 16 }}>
                {screenshotError}
              </p>
            )}

            {state.screenshotPreview && state.screenshotFile && (
              <div className="screenshot-row">
                <img
                  src={state.screenshotPreview}
                  alt="Payment screenshot preview"
                  className="screenshot-preview"
                />
                <div className="text-small">
                  <p style={{ margin: 0, fontWeight: 600, wordBreak: 'break-all' }}>{state.screenshotFile.name}</p>
                  <p className="text-secondary" style={{ margin: 0 }}>
                    {(state.screenshotFile.size / 1024).toFixed(0)} KB · ready to submit
                  </p>
                </div>
              </div>
            )}

            <button
              type="button"
              className="btn btn--primary btn--full"
              id="verify-payment-btn"
              onClick={handleSubmit}
              disabled={submitting}
              aria-busy={submitting}
            >
              {submitting ? (
                <>
                  <span className="spinner" aria-hidden="true" /> Submitting…
                </>
              ) : (
                'I\u2019ve paid — verify payment'
              )}
            </button>

            <p className="text-secondary text-small" style={{ textAlign: 'center', marginTop: 12 }}>
              Uploading a screenshot doesn't confirm payment. Our team verifies every
              payment against the bank credit before your order becomes active.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
