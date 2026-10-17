import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useSession } from '../../../lib/supabase';
import { readCustomerDetails } from '../../../lib/customer';
import { formatINR, formatPackSize, getErrorMessage } from '../../../lib/api';
import EmailSignIn from '../../../components/common/EmailSignIn';
import Notice from '../../../components/common/Notice';
import { getOrder, getOrderTracking } from '../api/ordersApi';
import type { Order, TrackingEvent } from '../../../types/orders';

export default function OrderTrackingPage() {
  const { orderId = '' } = useParams();
  const { session, loading: authLoading } = useSession();
  const [input, setInput] = useState(orderId);
  const [lookup, setLookup] = useState(orderId);
  const [attempt, setAttempt] = useState(0);
  const [order, setOrder] = useState<Order | null>(null);
  const [events, setEvents] = useState<TrackingEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setInput(orderId); setLookup(orderId); }, [orderId]);
  useEffect(() => {
    let active = true;
    setOrder(null); setEvents([]); setError('');
    if (!session || !lookup.trim()) return;
    setLoading(true);
    Promise.all([getOrder(lookup.trim()), getOrderTracking(lookup.trim())]).then(([data, history]) => {
      if (active) { setOrder(data); setEvents(history.events); }
    }).catch(cause => { if (active) setError(getErrorMessage(cause)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [session?.user.id, lookup, attempt]);
  function track(event: FormEvent) {
    event.preventDefault();
    if (!input.trim()) { setError('Enter your order ID.'); return; }
    setLookup(input.trim()); setAttempt(attempt + 1);
  }
  return (
    <div className="wrapper">
      <h1 className="page__header">Track your order</h1>
      <form className="card tracking-search" onSubmit={track}>
        <div className="form-row">
          <div><label htmlFor="track-order-id">Order ID</label><input className="input" id="track-order-id" value={input} onChange={e => setInput(e.target.value)} placeholder="#BFP-1042" required maxLength={100} /></div>
          <div><label htmlFor="track-mobile">Contact number</label><input className="input" id="track-mobile" type="tel" value={session ? `+91 ${readCustomerDetails(session.user.user_metadata).phone}` : ''} readOnly /></div>
          <button className="btn btn--dark" disabled={!session || loading}>{loading ? 'Loading…' : 'Track'}</button>
        </div>
      </form>
      {authLoading ? <p role="status">Checking your sign-in…</p> : !session ? <EmailSignIn /> : null}
      {error && <Notice tone="warning" title="Tracking is unavailable">{error}</Notice>}
      {loading && session && <p role="status">Loading order history…</p>}
      {order && session && (
        <div className="two-col">
          <section className="two-col__main card">
            <h3>Order {order.orderNumber}</h3>
            {events.length ? <ol className="timeline" style={{ marginTop: 24 }}>{events.map((event, index) => (
              <li className="timeline__item" key={`${event.status}-${index}`}>
                <span className="stepper__circle" aria-hidden="true">{index + 1}</span>
                <div><strong>{event.label}</strong><p className="text-secondary text-small">{new Date(event.timestamp).toLocaleString('en-IN')}</p><p>{event.description}</p></div>
              </li>
            ))}</ol> : <p className="text-secondary" style={{ marginTop: 16 }}>No tracking updates yet.</p>}
          </section>
          <aside className="two-col__side card card--tinted">
            <h3>Delivery details</h3>
            <div className="summary-row"><span>Items</span><strong>{order.productName} · {formatPackSize(order.packSize)} × {order.quantity}</strong></div>
            <div className="summary-row"><span>{order.paymentStatus === 'verified' ? 'Paid' : 'Order total'}</span><strong>{formatINR(order.total)}</strong></div>
            <div className="summary-row"><span>Deliver to</span><strong>{order.address} – {order.pinCode}</strong></div>
            <a className="btn btn--full" href="tel:+918000961030">Call store</a><Link className="btn btn--full" to="/help">Help with this order</Link>
          </aside>
        </div>
      )}
    </div>
  );
}
