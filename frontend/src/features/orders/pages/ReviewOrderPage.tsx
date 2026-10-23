import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import OrderStepper from '../../../components/common/OrderStepper';
import Notice from '../../../components/common/Notice';
import {
  useOrder,
  useOrderDispatch,
  buildSummary,
  validateForm,
  toOrderFormData,
  persistDraft,
} from '../../../context/OrderContext';
import { formatINR, formatPackSize, getErrorMessage, isNetworkError } from '../../../lib/api';
import { env } from '../../../lib/env';
import { createOrder } from '../api/ordersApi';
import { primaryImage } from '../../catalog/components/ProductParts';
import { useSession } from '../../../lib/auth';
import EmailSignIn from '../../../components/common/EmailSignIn';
import ProductName from '../../../components/common/ProductName';

type SubmitError = { kind: 'offline' | 'server'; message: string } | null;

export default function ReviewOrderPage() {
  const state = useOrder();
  const dispatch = useOrderDispatch();
  const navigate = useNavigate();
  const summary = buildSummary(state);
  const pendingAmount = state.quoteError || state.catalogError ? 'Unavailable' : 'Pending quote';
  const reviewProduct = state.products.find((item) => item.type === state.product);
  const reviewImage = reviewProduct ? primaryImage(reviewProduct) : null;
  const { session } = useSession();
  const mounted = useRef(true);
  const requestScope = JSON.stringify({ draft: toOrderFormData(state), userId: session?.user.id });
  const currentScope = useRef(requestScope);
  currentScope.current = requestScope;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<SubmitError>(null);

  // Guard: the review step requires a valid form (e.g. direct URL visit / refresh).
  if (Object.keys(validateForm(state)).length > 0) {
    return <Navigate to="/order" replace />;
  }

  const hasServerTotals = state.serverOrder !== null;

  async function handleContinue() {
    if (!confirmed || submitting || !session || (!state.quote && !state.serverOrder)) return;

    // Order already created for these exact details — don't create a duplicate.
    if (state.serverOrder) {
      navigate('/order/payment');
      return;
    }

    const scope = currentScope.current;
    const key = state.checkoutKey || crypto.randomUUID();
    if (!state.checkoutKey) {
      dispatch({ type: 'SET_CHECKOUT_KEY', payload: key });
      persistDraft({ ...state, checkoutKey: key }, session.user.id);
    }
    setSubmitting(true);
    setError(null);
    try {
      // FastAPI calculates the payable amount and issues the real order ID
      // and official payment instructions. Nothing here is client-trusted.
      const order = await createOrder(toOrderFormData(state), key);
      if (!mounted.current || currentScope.current !== scope) return;
      persistDraft({ ...state, orderId: order.id, checkoutKey: key }, session.user.id);
      dispatch({ type: 'SET_SERVER_ORDER', payload: order });
      if (state.quote && (order.total !== state.quote.total || order.subtotal !== state.quote.subtotal || order.deliveryFee !== state.quote.deliveryFee)) {
        setConfirmed(false);
        setError({ kind: 'server', message: 'The server updated your amount. Review the totals and confirm again before payment.' });
        return;
      }
      navigate('/order/payment');
    } catch (err) {
      if (!mounted.current || currentScope.current !== scope) return;
      setError({
        kind: isNetworkError(err) ? 'offline' : 'server',
        message: getErrorMessage(err),
      });
    } finally {
      if (mounted.current) setSubmitting(false);
    }
  }

  const whatsappText = encodeURIComponent(
    `Hello Balaji Faki Point, I'd like to order ${summary.productName} ${formatPackSize(summary.packSize)} × ${summary.quantity}.\n` +
      `Name: ${state.fullName}\nPhone: ${state.phone}\nAddress: ${state.address} – ${state.pinCode}`,
  );
  const whatsappHref = `https://wa.me/${env.supportWhatsApp}?text=${whatsappText}`;

  return (
    <div className="wrapper">
      <OrderStepper currentStep={2} />

      <h1 className="page__header">Review your order</h1>
      <p className="page__subtitle">Check everything before you pay.</p>

      {error?.kind === 'offline' && (
        <Notice
          tone="warning"
          title="Online ordering isn't connected right now"
          id="order-offline-notice"
          actions={
            <>
              <button type="button" className="btn btn--sm" onClick={handleContinue}>
                Try again
              </button>
              <a className="btn btn--sm" href={whatsappHref} target="_blank" rel="noopener noreferrer">
                Order on WhatsApp
              </a>
            </>
          }
        >
          We couldn't confirm the server's response. Your order may have been received.
          Please retry with the same details or contact the store before placing another order.
        </Notice>
      )}

      {error?.kind === 'server' && (
        <Notice tone="error" title="We couldn't create your order" id="order-error-notice">
          {error.message}
        </Notice>
      )}

      <div className="two-col review-layout">
        {/* ---- Main: Items & Delivery ---- */}
        <div className="two-col__main">
          {!session && (
            <>
              <Notice tone="warning" title="Sign in to place your order" id="review-signin-notice">
                Your order details are saved on this device. Sign in or create an account to place the order; you will come straight back to this page.
              </Notice>
              <EmailSignIn />
            </>
          )}
          {!state.serverOrder && state.catalogError && <Notice tone="error" title="Cannot load products and prices">
            {state.catalogError} <button type="button" className="btn btn--sm" onClick={() => dispatch({ type: 'RETRY_CATALOG' })}>Try again</button>
          </Notice>}
          {/* Items card */}
          <section className="card" style={{ marginBottom: 24 }} aria-labelledby="items-heading">
            <div className="detail-header">
              <h3 id="items-heading">Items</h3>
              <Link to="/order" className="text-small" style={{ color: 'var(--color-primary-dark)' }}>
                Edit
              </Link>
            </div>
            <div className="summary-row">
              <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                {reviewImage && <img className="product-thumb" src={reviewImage.url} alt={reviewImage.alt} loading="lazy" decoding="async" />}
                <span><ProductName name={summary.productName} nameGu={summary.productNameGu} /> · {formatPackSize(summary.packSize)} × {summary.quantity}</span>
              </span>
              <strong>{formatINR(summary.subtotal)}</strong>
            </div>
          </section>

          {/* Delivery details card */}
          <section className="card" aria-labelledby="delivery-heading">
            <div className="detail-header">
              <h3 id="delivery-heading">Delivery details</h3>
              <Link to="/order#delivery-address" className="text-small" style={{ color: 'var(--color-primary-dark)' }}>
                Change address
              </Link>
            </div>
            <div className="summary-row">
              <span>Name</span>
              <strong>{state.fullName}</strong>
            </div>
            <div className="summary-row">
              <span>Phone</span>
              <strong>{state.phone}</strong>
            </div>
            <div className="summary-row">
              <span>Address</span>
              <strong style={{ maxWidth: 300, textAlign: 'right' }}>
                {`${state.address} – ${state.pinCode}`}
              </strong>
            </div>
          </section>
        </div>

        {/* ---- Sidebar: Amount to pay ---- */}
        <aside className="two-col__side">
          <div className="card card--tinted" id="amount-to-pay">
            <h2 className="summary-heading">Amount to pay</h2>

            <div className="summary-row">
              <span>Subtotal</span>
              <strong>{formatINR(summary.subtotal)}</strong>
            </div>
            <div className="summary-row">
              <span>Delivery</span>
              <strong>{summary.deliveryFee === null ? pendingAmount : formatINR(summary.deliveryFee)}</strong>
            </div>
            <div className="summary-row" >
              <span>Total</span>
              <strong>{summary.total === null ? pendingAmount : formatINR(summary.total)}</strong>
            </div>

            {!hasServerTotals && state.quoteError && <Notice tone="error" title="Cannot calculate checkout total">
              {state.quoteError} <button type="button" className="btn btn--sm" onClick={() => dispatch({ type: 'RETRY_CATALOG' })}>Try again</button>
            </Notice>}
            {!hasServerTotals && state.quoteStatus && <p className="text-small text-secondary catalog-status" role="status">{state.quoteStatus}</p>}
            {!hasServerTotals && !state.quote && !state.catalogError && !state.quoteError && !state.quoteStatus && (
              <p className="text-secondary text-small" style={{ margin: '8px 0 0' }} role="status">
                Waiting for the server to calculate delivery and total.
              </p>
            )}

            <div className="checkbox-row">
              <input
                type="checkbox"
                id="confirm-details"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              <label htmlFor="confirm-details" style={{ marginBottom: 0, fontWeight: 400 }}>
                My details are correct
              </label>
            </div>

            <button
              type="button"
              className="btn btn--primary btn--full"
              id="continue-payment-btn"
              onClick={handleContinue}
              disabled={!confirmed || submitting || !session || (!state.quote && !state.serverOrder)}
              aria-busy={submitting}
            >
              {submitting ? (
                <>
                  <span className="spinner" aria-hidden="true" /> Creating your order…
                </>
              ) : (
                'Continue to QR Payment →'
              )}
            </button>

            <button
              type="button"
              className="btn btn--full"
              id="back-to-details-btn"
              onClick={() => navigate('/order')}
              style={{ marginTop: 8 }}
            >
              ← Back to details
            </button>

            <p className="text-secondary text-small" style={{ marginTop: 12 }}>
              You'll pay by scanning a UPI QR on the next step.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
