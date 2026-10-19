import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import OrderStepper from '../../../components/common/OrderStepper';
import NoActiveOrder from '../../../components/common/NoActiveOrder';
import Notice from '../../../components/common/Notice';
import EmailSignIn from '../../../components/common/EmailSignIn';
import { useOrder, useOrderDispatch } from '../../../context/OrderContext';
import { useSession } from '../../../lib/supabase';
import { formatINR, formatPackSize, getErrorMessage } from '../../../lib/api';
import { getOrder } from '../api/ordersApi';
import { getPaymentStatus, isPaymentConfirmed, isConfirmedOrder } from '../../payments/api/paymentsApi';
import type { Order } from '../../../types/orders';

export default function OrderConfirmationPage() {
  const state = useOrder();
  const dispatch = useOrderDispatch();
  const navigate = useNavigate();
  const { session, loading } = useSession();
  const [confirmedOrder, setConfirmedOrder] = useState<Order | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const { orderId } = state;
  useEffect(() => {
    let active = true;
    setConfirmedOrder(null); setError('');
    if (!orderId || !session) return;
    Promise.all([getOrder(orderId), getPaymentStatus(orderId)]).then(([order, payment]) => {
      if (!active) return;
      dispatch({ type: 'SET_PAYMENT_STATUS', payload: payment.status });
      if (isPaymentConfirmed(payment) && (order.paymentStatus === 'VERIFIED' || order.paymentStatus === 'verified') && isConfirmedOrder(order.status)) {
        setConfirmedOrder(order);
      } else navigate('/order/verification', { replace: true });
    }).catch(cause => { if (active) setError(getErrorMessage(cause)); });
    return () => { active = false; };
  }, [orderId, session?.user.id, attempt, dispatch, navigate]);
  if (!orderId) return <div className="wrapper"><OrderStepper currentStep={5} /><NoActiveOrder title="No confirmed order" message="An order can be confirmed only after the server verifies payment and confirms the order." /></div>;
  if (loading) return <div className="wrapper"><p role="status">Checking your sign-in…</p></div>;
  if (!session) return <div className="wrapper"><EmailSignIn /></div>;
  if (!confirmedOrder) return <div className="wrapper"><OrderStepper currentStep={5} />{error ? <Notice tone="warning" title="Confirmation is unavailable" actions={<button className="btn" onClick={() => setAttempt(attempt + 1)}>Check again</button>}>{error} Please don't pay again.</Notice> : <p role="status">Checking payment and order confirmation with the store…</p>}</div>;
  const orderNumber = confirmedOrder.orderNumber;
  const deliverTo = `${confirmedOrder.address} – ${confirmedOrder.pinCode}`;
  return (
    <div className="wrapper">
      <OrderStepper currentStep={5} />

      <div style={{ maxWidth: 720, margin: '0 auto', textAlign: 'center' }}>
        {/* Success icon */}
        <div className="circle-icon circle-icon--success">
          <svg className="icon icon--lg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>

        <h1 style={{ marginBottom: 8 }}>Order confirmed</h1>
        <p className="text-secondary">
          Payment verified. Order {orderNumber} is now active.
        </p>

        {/* Summary card */}
        <div className="card" style={{ marginTop: 32, textAlign: 'left', maxWidth: 648, marginLeft: 'auto', marginRight: 'auto' }}>
          <div className="summary-row">
            <span>Items</span>
            <strong>{confirmedOrder.productName} · {formatPackSize(confirmedOrder.packSize)} × {confirmedOrder.quantity}</strong>
          </div>
          <div className="summary-row">
            <span>Paid</span>
            <strong>{formatINR(confirmedOrder.total)} via UPI</strong>
          </div>
          <div className="summary-row">
            <span>Deliver to</span>
            <strong style={{ maxWidth: 280, textAlign: 'right' }}>
              {deliverTo}
            </strong>
          </div>
        </div>

        {/* What happens next */}
        <div className="flow-steps" style={{ maxWidth: 720, margin: '32px auto' }}>
          <div className="flow-step">
            <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
              <polyline points="16 21 12 17 8 21" />
              <line x1="12" y1="3" x2="12" y2="7" />
            </svg>
            <span>We pack your order</span>
          </div>
          <span className="flow-arrow">→</span>
          <div className="flow-step">
            <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="1" y="3" width="15" height="13" rx="2" />
              <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
              <circle cx="5.5" cy="18.5" r="2.5" />
              <circle cx="18.5" cy="18.5" r="2.5" />
            </svg>
            <span>We dispatch it</span>
          </div>
          <span className="flow-arrow">→</span>
          <div className="flow-step">
            <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
            <span>It reaches your door</span>
          </div>
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'center' }}>
          <Link to={`/my-orders/${encodeURIComponent(orderId)}`} className="btn btn--primary" id="order-details-btn">
            View Order Details
          </Link>
          <Link to="/my-orders" className="btn" id="my-orders-btn">
            My Orders
          </Link>
          <Link
            to="/"
            className="btn"
            id="back-home-btn"
            onClick={() => dispatch({ type: 'RESET' })}
          >
            Back to Home
          </Link>
        </div>
      </div>
    </div>
  );
}
