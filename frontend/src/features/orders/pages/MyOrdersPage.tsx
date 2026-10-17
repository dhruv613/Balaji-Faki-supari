import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, useSession } from '../../../lib/supabase';
import { formatINR, formatPackSize, getErrorMessage } from '../../../lib/api';
import EmailSignIn from '../../../components/common/EmailSignIn';
import Notice from '../../../components/common/Notice';
import { getMyOrders } from '../api/ordersApi';
import { useOrderDispatch } from '../../../context/OrderContext';
import type { Order, OrderStatus } from '../../../types/orders';

type Filter = 'all' | 'active' | 'delivered' | 'pending';
const LABELS: Record<OrderStatus, string> = {
  pending_payment: 'Pending payment', verifying_payment: 'Verifying payment', active: 'Active',
  packing: 'Packing', dispatched: 'Dispatched', out_for_delivery: 'Out for delivery', delivered: 'Delivered',
};

export default function MyOrdersPage() {
  const { session, loading: authLoading } = useSession();
  const dispatch = useOrderDispatch();
  const [filter, setFilter] = useState<Filter>('all');
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setOrders([]); setError('');
    if (!session) return;
    setLoading(true);
    getMyOrders().then(data => { if (active) setOrders(data); })
      .catch(cause => { if (active) setError(getErrorMessage(cause)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [session?.user.id, attempt]);
  const filtered = orders.filter(order => {
    if (filter === 'all') return true;
    if (filter === 'delivered') return order.status === 'delivered';
    if (filter === 'pending') return ['pending_payment', 'verifying_payment'].includes(order.status);
    return ['active', 'packing', 'dispatched', 'out_for_delivery'].includes(order.status);
  });
  return (
    <div className="wrapper">
      <div className="detail-header"><h1 className="page__header">My Orders</h1>{session && <button className="btn btn--sm" type="button" onClick={async () => {
        try { const result = await supabase?.auth.signOut(); if (result?.error) setError(result.error.message); }
        catch { setError('Unable to sign out. Please try again.'); }
      }}>Sign out</button>}</div>
      <div className="order-filters" aria-label="Filter orders">
        {(['all', 'active', 'delivered', 'pending'] as Filter[]).map(value => (
          <button type="button" key={value} className={`chip${filter === value ? ' chip--active' : ''}`} aria-pressed={filter === value} onClick={() => setFilter(value)}>
            {value === 'all' ? 'All' : value === 'active' ? 'Active' : value === 'delivered' ? 'Delivered' : 'Pending payment'}
          </button>
        ))}
      </div>
      {authLoading ? <p role="status">Checking your sign-in…</p> : !session ? <EmailSignIn /> : (
        <>
          {loading && <p role="status">Loading your orders…</p>}
          {error && <Notice tone="warning" title="Orders are unavailable" actions={<button className="btn btn--sm" onClick={() => setAttempt(attempt + 1)}>Try again</button>}>{error}</Notice>}
          {!loading && !error && !filtered.length && <div className="card empty-state"><p>No orders found.</p><Link to="/order" className="btn btn--primary btn--full">Place an order</Link></div>}
          {filtered.map(order => (
            <article className="order-card" key={order.id}>
              <div><div className="order-card__id">{order.orderNumber}</div><div className="order-card__date">{new Date(order.createdAt).toLocaleDateString('en-IN', {day:'numeric', month:'short', year:'numeric'})}</div></div>
              <div className="order-card__details"><span className="order-card__product">{order.productName} · {formatPackSize(order.packSize)} × {order.quantity}</span><span className="order-card__amount">{formatINR(order.total)}</span></div>
              <span className={`badge ${['pending_payment', 'verifying_payment'].includes(order.status) ? '' : 'badge--dark'}`}>{LABELS[order.status]}</span>
              <Link className="btn" onClick={() => { if (order.status === 'delivered') dispatch({ type: 'RESET' }); }} to={order.status === 'delivered' ? `/order?product=${order.product}` : `/track/${encodeURIComponent(order.id)}`}>{order.status === 'delivered' ? 'Reorder' : 'Track'}</Link>
            </article>
          ))}
        </>
      )}
    </div>
  );
}
