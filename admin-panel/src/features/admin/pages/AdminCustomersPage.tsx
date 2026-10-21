import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Notice from '../../../components/common/Notice';
import { formatINR, getErrorMessage } from '../../../lib/api';
import { env } from '../../../lib/env';
import { getAdminCustomerById, getAdminCustomers } from '../api';
import { formatDate } from '../lib/formatDateTime';
import { DetailDrawer, EmptyState, ErrorState, LoadingSkeleton } from '../components';
import type { AdminCustomer } from '../../../types/orders';
import type { AdminCustomerDetailRecord, AdminCustomersQueryParams } from '../types';

type Filter = NonNullable<AdminCustomersQueryParams['status']>;

const STATUS_STYLE: Record<string, string> = {
  Repeat: 'badge--dark',
  Active: 'badge--green',
  New: 'badge--outline',
  'Pending payment': 'badge--outline',
};

/** Read-only customers from real accounts and orders. Contact data is shown to the Owner Admin only. */
export default function AdminCustomersPage() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<Filter>('all');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<{ items: AdminCustomer[]; total: number; totalPages: number } | null>(null);
  const [loading, setLoading] = useState(Boolean(env.apiBaseUrl));
  const [error, setError] = useState('');
  const [detail, setDetail] = useState<AdminCustomerDetailRecord | null>(null);
  const [detailError, setDetailError] = useState('');

  const load = useCallback(() => {
    if (!env.apiBaseUrl) return;
    let active = true;
    setLoading(true); setError('');
    getAdminCustomers({ search: search.trim() || undefined, status, page, pageSize: 20 })
      .then((res) => { if (active) setResult(res); })
      .catch((cause) => { if (active) setError(getErrorMessage(cause)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [search, status, page]);
  useEffect(() => { const timer = window.setTimeout(load, 250); return () => window.clearTimeout(timer); }, [load]);

  function openCustomer(customer: AdminCustomer) {
    setDetailError(''); setDetail({ ...customer, orderHistory: [], reviews: [] });
    getAdminCustomerById(customer.id).then(setDetail).catch((cause) => setDetailError(getErrorMessage(cause)));
  }

  return (
    <div className="wrapper">
      <div className="admin-heading">
        <div>
          <h1 className="page__header">Customers</h1>
          <p className="page__subtitle">Read-only customer and order information.</p>
        </div>
      </div>

      {!env.apiBaseUrl && <Notice tone="warning" title="Server not connected">Connect the local FastAPI server to see customers. No sample customers are shown.</Notice>}

      <div className="card" style={{ marginBottom: 16, display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ flex: '1 1 240px' }}>
          <label htmlFor="customer-search">Search name, phone or e-mail</label>
          <input id="customer-search" className="input" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} maxLength={100} />
        </div>
        <div>
          <label htmlFor="customer-status">Show</label>
          <select id="customer-status" className="input" value={status} onChange={(event) => { setStatus(event.target.value as Filter); setPage(1); }}>
            <option value="all">All customers</option>
            <option value="new">New</option>
            <option value="repeat">Repeat</option>
            <option value="pending">Pending payment</option>
          </select>
        </div>
      </div>

      {error && <ErrorState message={error} onRetry={load} />}
      {loading && !result && <LoadingSkeleton rows={5} />}
      {result && result.items.length === 0 && <EmptyState title="No customers found" description="Customers appear here after they register and place orders." />}
      {result && result.items.length > 0 && (
        <div className="card">
          <div className="admin-table-wrap" role="region" aria-label="Customers" tabIndex={0}>
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Customer</th><th scope="col">Phone</th><th scope="col">Area</th><th scope="col">Orders</th>
                  <th scope="col">Total spent</th><th scope="col">Last order</th><th scope="col">Rating</th><th scope="col">Status</th>
                  <th scope="col"><span className="sr-only">Details</span></th>
                </tr>
              </thead>
              <tbody>
                {result.items.map((customer) => (
                  <tr key={customer.id}>
                    <td><strong>{customer.name}</strong></td>
                    <td>{customer.phone}</td>
                    <td>{customer.location || '—'}</td>
                    <td>{customer.orders}</td>
                    <td>{formatINR(customer.totalSpent)}</td>
                    <td>{formatDate(customer.lastOrder)}</td>
                    <td>{customer.review === null ? '—' : customer.review.toFixed(1)}</td>
                    <td><span className={`badge ${STATUS_STYLE[customer.status] ?? ''}`}>{customer.status}</span></td>
                    <td><button type="button" className="btn btn--sm" onClick={() => openCustomer(customer)}>View</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
            <span className="text-small text-secondary">{result.total} customer{result.total === 1 ? '' : 's'} · page {page} of {result.totalPages}</span>
            <span style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn btn--sm" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</button>
              <button type="button" className="btn btn--sm" disabled={page >= result.totalPages} onClick={() => setPage((value) => value + 1)}>Next</button>
            </span>
          </div>
        </div>
      )}

      <DetailDrawer open={detail !== null} title={detail?.name ?? ''} subtitle={detail?.phone} onClose={() => setDetail(null)}>
        {detailError && <Notice tone="error">{detailError}</Notice>}
        {detail && (
          <>
            <dl className="admin-kv-grid">
              <div className="admin-kv-item"><dt>E-mail</dt><dd>{detail.email || '—'}</dd></div>
              <div className="admin-kv-item"><dt>Address</dt><dd>{detail.fullAddress || '—'}{detail.pinCode ? ` – ${detail.pinCode}` : ''}</dd></div>
              <div className="admin-kv-item"><dt>Joined</dt><dd>{formatDate(detail.joinedDate)}</dd></div>
            </dl>
            <h3 style={{ marginTop: 16 }}>Orders</h3>
            {detail.orderHistory.length === 0 ? <p className="text-secondary">No orders yet.</p> : (
              <ul style={{ listStyle: 'none', padding: 0 }}>
                {detail.orderHistory.map((order) => (
                  <li className="summary-row" key={order.orderId}>
                    <span><Link to={`/admin/orders?q=${encodeURIComponent(order.orderNumber)}`}>{order.orderNumber}</Link> · {order.itemsSummary}</span>
                    <span>{formatINR(order.amount)} · {order.orderStatus}</span>
                  </li>
                ))}
              </ul>
            )}
            <h3 style={{ marginTop: 16 }}>Reviews</h3>
            {detail.reviews.length === 0 ? <p className="text-secondary">No reviews.</p> : detail.reviews.map((review) => (
              <p key={review.id}><strong>{review.rating}★</strong> {review.feedback}</p>
            ))}
          </>
        )}
      </DetailDrawer>
    </div>
  );
}
