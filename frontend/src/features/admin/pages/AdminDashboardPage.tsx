import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Notice from '../../../components/common/Notice';
import { formatINR, getErrorMessage } from '../../../lib/api';
import { env } from '../../../lib/env';
import { getAdminDashboard } from '../api';
import { EmptyState, ErrorState, LoadingSkeleton, StatCard, StatusBadge } from '../components';
import type { AdminDashboardResponse } from '../types';

/** Dashboard: Products Sold, Net Profit and the Pending Payment Confirmations table. Nothing else. */
export default function AdminDashboardPage() {
  const [data, setData] = useState<AdminDashboardResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(Boolean(env.apiBaseUrl));

  const load = useCallback(() => {
    if (!env.apiBaseUrl) return;
    setLoading(true);
    setError('');
    getAdminDashboard()
      .then(setData)
      .catch((cause) => setError(getErrorMessage(cause)))
      .finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);

  return (
    <div className="wrapper">
      <div className="admin-heading">
        <div>
          <h1 className="page__header">Dashboard</h1>
          <p className="page__subtitle">Real figures from delivered orders with verified payments.</p>
        </div>
      </div>

      {!env.apiBaseUrl && (
        <Notice tone="warning" title="Server not connected">
          Connect the local FastAPI server to see live figures. No sample figures are shown.
        </Notice>
      )}
      {error && <ErrorState message={error} onRetry={load} />}
      {loading && !data && <LoadingSkeleton rows={3} />}

      {data && <DashboardView data={data} />}
    </div>
  );
}

/** The three dashboard elements, rendered from real data. */
export function DashboardView({ data }: { data: AdminDashboardResponse }) {
  const net = data.netProfit;
  return (
        <>
          <div className="admin-kpi-grid" style={{ marginBottom: 24 }}>
            <StatCard label="Products Sold" value={data.productsSold.toLocaleString('en-IN')} subtitle="Units in delivered, paid orders" />
            <StatCard
              label="Net Profit"
              value={net.status === 'OK' && net.amount !== null ? formatINR(net.amount) : 'Not configured'}
              subtitle={net.status === 'OK' ? 'Item revenue minus cost and completed refunds' : net.reason ?? undefined}
            />
          </div>
          {net.note && <Notice tone="warning" title="Development data included">{net.note}</Notice>}

          <section className="card" aria-labelledby="pending-confirmations-heading">
            <h2 id="pending-confirmations-heading" style={{ marginBottom: 12 }}>Pending Payment Confirmations</h2>
            {data.pendingPaymentConfirmations.length === 0 ? (
              <EmptyState title="Nothing waiting" description="No payment screenshots are waiting for bank-credit verification." />
            ) : (
              <div className="admin-table-wrap" role="region" aria-label="Pending payment confirmations" tabIndex={0}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col">Order</th>
                      <th scope="col">Customer</th>
                      <th scope="col">Amount</th>
                      <th scope="col">UTR</th>
                      <th scope="col">Submitted</th>
                      <th scope="col">Status</th>
                      <th scope="col"><span className="sr-only">Action</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.pendingPaymentConfirmations.map((row) => (
                      <tr key={row.paymentId}>
                        <td><strong>{row.orderNumber}</strong></td>
                        <td>{row.customerName}</td>
                        <td>{formatINR(row.amount)}</td>
                        <td>{row.utr}</td>
                        <td>{new Date(row.submittedAt).toLocaleString('en-IN')}</td>
                        <td><StatusBadge status={row.status} /></td>
                        <td><Link className="btn btn--sm btn--primary" to={`/admin/payments?payment=${encodeURIComponent(row.paymentId)}`}>Review</Link></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
  );
}
