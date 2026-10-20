import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { authClient, signOut, useSession } from '../../../lib/auth';
import { formatINR, formatPackSize, getErrorMessage } from '../../../lib/api';
import EmailSignIn from '../../../components/common/EmailSignIn';
import Notice from '../../../components/common/Notice';
import { getMyOrders } from '../api/ordersApi';
import { ORDER_STATUS_DISPLAY_LABELS } from '../../../types/orders';
import type { Order, OrderStatus } from '../../../types/orders';
import ProductName, { findNameGu } from '../../../components/common/ProductName';
import { useOrder } from '../../../context/OrderContext';

type Filter = 'all' | 'active' | 'delivered' | 'pending';
const PENDING_STATUSES: OrderStatus[] = [
  'PENDING_PAYMENT',
  'PAYMENT_REVIEW',
  'AWAITING_CONFIRMATION',
  'pending_payment',
  'verifying_payment',
];
const ACTIVE_STATUSES: OrderStatus[] = [
  'CONFIRMED',
  'PACKING',
  'PACKED',
  'PICKED_UP',
  'SHIPPED',
  'OUT_FOR_DELIVERY',
  'active',
  'packing',
  'dispatched',
  'out_for_delivery',
];

export default function MyOrdersPage() {
  const { session, loading: authLoading } = useSession();
  const { products } = useOrder();
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
    if (filter === 'delivered') return order.status === 'DELIVERED' || order.status === 'delivered';
    if (filter === 'pending') return PENDING_STATUSES.includes(order.status);
    return ACTIVE_STATUSES.includes(order.status);
  });
  return (
    <div className="wrapper">
      <div className="detail-header"><h1 className="page__header">My Orders</h1>{session && <button className="btn btn--sm" type="button" onClick={async () => {
        try { await signOut(); }
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
          {filtered.map(order => {
            return (
              <article className="order-card" key={order.id}>
                <div><div className="order-card__id">{order.orderNumber}</div><div className="order-card__date">{new Date(order.createdAt).toLocaleDateString('en-IN', {day:'numeric', month:'short', year:'numeric'})}</div></div>
                <div className="order-card__details"><span className="order-card__product" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>{order.productImageUrl && <img className="product-thumb" src={order.productImageUrl} alt={order.productName} loading="lazy" decoding="async" />}<span><ProductName name={order.productName} nameGu={findNameGu(products, order.product)} /> · {formatPackSize(order.packSize)} × {order.quantity}</span></span><span className="order-card__amount">{formatINR(order.total)}</span></div>
                <span className={`badge ${PENDING_STATUSES.includes(order.status) ? '' : 'badge--dark'}`}>{ORDER_STATUS_DISPLAY_LABELS[order.status]}</span>
                <Link className="btn" to={`/my-orders/${encodeURIComponent(order.id)}`}>View order</Link>
              </article>
            );
          })}
        </>
      )}
    </div>
  );
}
