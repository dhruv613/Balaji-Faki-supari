import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useSession } from '../../../lib/supabase';
import { formatINR, formatPackSize, getErrorMessage } from '../../../lib/api';
import EmailSignIn from '../../../components/common/EmailSignIn';
import Notice from '../../../components/common/Notice';
import { ORDER_STATUS_DISPLAY_LABELS } from '../../../types/orders';
import { cancelOrder, getOrder, getOrderTracking } from '../api/ordersApi';
import type { Order, OrderStatus, TrackingEvent } from '../../../types/orders';

export default function OrderDetailsPage() {
  const { orderId = '' } = useParams();
  const { session, loading: authLoading } = useSession();
  const [order, setOrder] = useState<Order | null>(null);
  const [events, setEvents] = useState<TrackingEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [cancelReason, setCancelReason] = useState('');
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    let active = true;
    setOrder(null); setEvents([]); setError('');
    if (!session || !orderId) return;
    setLoading(true);
    Promise.all([getOrder(orderId), getOrderTracking(orderId)])
      .then(([data, history]) => {
        if (active) { setOrder(data); setEvents(history.events); }
      })
      .catch(cause => { if (active) setError(getErrorMessage(cause)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [orderId, session?.user.id]);

  const canCancel = order && ['PENDING_PAYMENT', 'PAYMENT_REVIEW', 'AWAITING_CONFIRMATION', 'CONFIRMED', 'PACKING', 'PACKED'].includes(order.status);

  async function handleCancel() {
    if (!order) return;
    if (cancelReason.trim().length < 5) {
      setError('Enter a cancellation reason of at least 5 characters.');
      return;
    }
    setCancelling(true); setError('');
    try {
      const updated = await cancelOrder(order.id, cancelReason.trim());
      const history = await getOrderTracking(order.id);
      setOrder(updated); setEvents(history.events); setCancelReason('');
    } catch (cause) {
      setError(getErrorMessage(cause));
    } finally {
      setCancelling(false);
    }
  }

  return (
    <div className="wrapper">
      <div className="detail-header"><h1 className="page__header">Order Details</h1><Link className="btn btn--sm" to="/my-orders">Back to My Orders</Link></div>
      {authLoading ? <p role="status">Checking your sign-in…</p> : !session ? <EmailSignIn /> : null}
      {loading && session && <p role="status">Loading order details…</p>}
      {error && <Notice tone="warning" title="Order details are unavailable">{error}</Notice>}
      {!loading && !error && session && !order && <Notice tone="warning" title="Order not found">Choose an order from My Orders.</Notice>}
      {order && session && (
        <div className="two-col">
          <section className="two-col__main card">
            <div className="detail-header"><div><h3>{order.orderNumber}</h3><p className="text-secondary text-small">Placed {new Date(order.createdAt).toLocaleString('en-IN')}</p></div><span className="badge badge--dark">{ORDER_STATUS_DISPLAY_LABELS[order.status]}</span></div>
            <h3 style={{ marginTop: 24 }}>Order progress</h3>
            {events.length ? <ol className="timeline" style={{ marginTop: 16 }}>{events.map((event, index) => {
              const label = ORDER_STATUS_DISPLAY_LABELS[event.status as OrderStatus] || event.label;
              return <li className="timeline__item" key={`${event.status}-${event.timestamp}-${index}`}>
                <span className="stepper__circle" aria-hidden="true">{index + 1}</span>
                <div><strong>{label}</strong><p className="text-secondary text-small">{new Date(event.timestamp).toLocaleString('en-IN')}</p>{event.description && <p>{event.description}</p>}</div>
              </li>;
            })}</ol> : <p className="text-secondary" style={{ marginTop: 16 }}>No completed order updates yet.</p>}
          </section>
          <aside className="two-col__side card card--tinted">
            <h3>Delivery details</h3>
            <div className="order-detail__product">
              {order.productImageUrl && <img className="order-detail__product-image" src={order.productImageUrl} alt={order.productName} width="96" height="72" />}
              <strong>{order.productName}</strong>
            </div>
            <div className="summary-row"><span>Items</span><strong>{order.productName} · {formatPackSize(order.packSize)} × {order.quantity}</strong></div>
            <div className="summary-row"><span>Payment</span><strong>{order.paymentStatus}</strong></div>
            <div className="summary-row"><span>Order total</span><strong>{formatINR(order.total)}</strong></div>
            <div className="summary-row"><span>Deliver to</span><strong>{order.address} – {order.pinCode}</strong></div>
            <a className="btn btn--full" href="tel:+918000961030">Call store</a><Link className="btn btn--full" to="/help">Help with this order</Link>
            {canCancel && <div style={{ marginTop: 16 }}>
              <label htmlFor="cancel-order-reason">Need to cancel?</label>
              <textarea id="cancel-order-reason" className="input" value={cancelReason} onChange={event => setCancelReason(event.target.value)} placeholder="Tell us why you need to cancel" maxLength={500} />
              <button type="button" className="btn btn--full" disabled={cancelling} onClick={handleCancel}>{cancelling ? 'Cancelling…' : 'Cancel order'}</button>
            </div>}
          </aside>
        </div>
      )}
    </div>
  );
}
