import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Notice from '../../../components/common/Notice';
import type { AdminCustomer } from '../../../types/orders';
import type { AdminCustomerDetailRecord } from '../types';

// Supplied design examples; no real customer data is available before FastAPI integration.
const SAMPLE_CUSTOMERS: AdminCustomer[] = [
  { id: '1', name: 'Rahul Mehta', initials: 'RM', phone: '+91 98XXX XX021', location: 'University Road', orders: 6, totalSpent: 0, lastOrder: '14 Oct 2026', review: 5.0, status: 'Repeat' },
  { id: '2', name: 'Hetal Patel', initials: 'HP', phone: '+91 97XXX XX342', location: 'Kalawad Road', orders: 3, totalSpent: 0, lastOrder: '12 Oct 2026', review: 5.0, status: 'Active' },
  { id: '3', name: 'Jignesh Shah', initials: 'JS', phone: '+91 99XXX XX118', location: 'Raiya Road', orders: 2, totalSpent: 0, lastOrder: '3 Oct 2026', review: 4.0, status: 'Active' },
  { id: '4', name: 'Pooja Dave', initials: 'PD', phone: '+91 98XXX XX765', location: 'Mavdi', orders: 4, totalSpent: 0, lastOrder: '28 Sep 2026', review: 5.0, status: 'Repeat' },
  { id: '5', name: 'Nilesh Bhatt', initials: 'NB', phone: '+91 90XXX XX409', location: 'Gondal Road', orders: 1, totalSpent: 0, lastOrder: '21 Sep 2026', review: 5.0, status: 'New' },
  { id: '6', name: 'Dipti Kotecha', initials: 'DK', phone: '+91 94XXX XX250', location: '150 Feet Ring Road', orders: 2, totalSpent: 0, lastOrder: '15 Sep 2026', review: 4.0, status: 'Active' },
  { id: '7', name: 'Amit Joshi', initials: 'AJ', phone: '+91 98XXX XX934', location: 'Yagnik Road', orders: 1, totalSpent: 0, lastOrder: '15 Oct 2026', review: null, status: 'Pending payment' },
  { id: '8', name: 'Kiran Trivedi', initials: 'KT', phone: '+91 99XXX XX586', location: 'Pedak Road', orders: 1, totalSpent: 0, lastOrder: '15 Oct 2026', review: null, status: 'New' },
];

const CUSTOMER_DETAILS_MAP: Record<string, AdminCustomerDetailRecord> = {
  '1': {
    ...SAMPLE_CUSTOMERS[0],
    email: 'rahul.mehta@example.test',
    fullAddress: 'Flat 302, Siddhi Residency, University Road, Rajkot',
    pinCode: '360005',
    joinedDate: '10 Aug 2026',
    orderHistory: [
      { orderId: 'ord-1042', orderNumber: '#BFP-1042', date: '14 Oct 2026', itemsSummary: 'Faki · 500 g × 2', amount: null, paymentStatus: 'VERIFIED', orderStatus: 'OUT_FOR_DELIVERY' },
      { orderId: 'ord-1031', orderNumber: '#BFP-1031', date: '28 Sep 2026', itemsSummary: 'Faki · 1 kg × 1', amount: null, paymentStatus: 'VERIFIED', orderStatus: 'DELIVERED' },
    ],
    reviews: [
      { id: 'rev-2', orderNumber: '#BFP-1031', rating: 5, feedback: 'Easy order form, and tracking showed every step until delivery.', createdAt: '9 Oct 2026' },
    ],
  },
  '2': {
    ...SAMPLE_CUSTOMERS[1],
    email: 'hetal.patel@example.test',
    fullAddress: '14 Shivalik Park, Kalawad Road, Rajkot',
    pinCode: '360005',
    joinedDate: '02 Sep 2026',
    orderHistory: [
      { orderId: 'ord-1041', orderNumber: '#BFP-1041', date: '14 Oct 2026', itemsSummary: 'Faki · 250 g × 2', amount: null, paymentStatus: 'VERIFIED', orderStatus: 'CONFIRMED' },
      { orderId: 'ord-1039', orderNumber: '#BFP-1039', date: '12 Oct 2026', itemsSummary: 'Faki · 500 g × 1', amount: null, paymentStatus: 'VERIFIED', orderStatus: 'DELIVERED' },
    ],
    reviews: [
      { id: 'rev-1', orderNumber: '#BFP-1039', rating: 5, feedback: 'Ordered online, paid by QR and got my confirmation quickly. Packing was neat.', createdAt: '12 Oct 2026' },
    ],
  },
};

type Filter = 'all' | 'new' | 'repeat' | 'pending';

const STATUS_STYLE: Record<string, string> = {
  Repeat: 'badge--dark',
  Active: 'badge--green',
  New: 'badge--outline',
  'Pending payment': 'badge--outline',
};

export function filterCustomers(customers: AdminCustomer[], query: string, area: string, status: Filter): AdminCustomer[] {
  const search = query.trim().toLocaleLowerCase();
  return customers.filter(customer => {
    const matchesStatus = status === 'all' || (status === 'pending' ? customer.status === 'Pending payment' : customer.status.toLocaleLowerCase() === status);
    return matchesStatus && (area === 'All areas' || customer.location === area) && `${customer.name} ${customer.phone} ${customer.location}`.toLocaleLowerCase().includes(search);
  });
}

export function customersToCsv(customers: AdminCustomer[]): string {
  const rows = [['Data source', 'Customer', 'Phone', 'Location', 'Orders', 'Total spent', 'Last order', 'Review', 'Status'], ...customers.map(customer => ['Development reference example', customer.name, customer.phone, customer.location, customer.orders, 'Not available', customer.lastOrder, customer.review ?? '', customer.status])];
  return rows.map(row => row.map(value => {
    const text = String(value);
    const safe = /^[=+\-@\t\r]/.test(text.trimStart()) ? `'${text}` : text;
    return `"${safe.replace(/"/g, '""')}"`;
  }).join(',')).join('\r\n');
}

function getDetailRecord(customer: AdminCustomer): AdminCustomerDetailRecord {
  return (
    CUSTOMER_DETAILS_MAP[customer.id] ?? {
      ...customer,
      email: `${customer.name.toLowerCase().replace(/\s+/g, '.')}@example.test`,
      fullAddress: `${customer.location}, Rajkot, Gujarat`,
      pinCode: '360005',
      joinedDate: customer.lastOrder,
      orderHistory: [
        {
          orderId: `ord-sample-${customer.id}`,
          orderNumber: `#BFP-104${customer.id}`,
          date: customer.lastOrder,
          itemsSummary: 'Faki · 500 g × 1',
          amount: null,
          paymentStatus: customer.status === 'Pending payment' ? 'SUBMITTED' : 'VERIFIED',
          orderStatus: customer.status === 'Pending payment' ? 'PAYMENT_REVIEW' : 'DELIVERED',
        },
      ],
      reviews:
        customer.review !== null
          ? [
              {
                id: `rev-sample-${customer.id}`,
                orderNumber: `#BFP-104${customer.id}`,
                rating: customer.review,
                feedback: 'Verified reference review from supplied design.',
                createdAt: customer.lastOrder,
              },
            ]
          : [],
    }
  );
}

export default function AdminCustomersPage() {
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [area, setArea] = useState('All areas');
  const [selected, setSelected] = useState<AdminCustomer | null>(null);
  const [exportError, setExportError] = useState('');
  const detailsRef = useRef<HTMLElement>(null);
  const areas = ['All areas', ...Array.from(new Set(SAMPLE_CUSTOMERS.map(customer => customer.location))).sort()];
  const filtered = filterCustomers(SAMPLE_CUSTOMERS, query, area, filter);
  const rated = SAMPLE_CUSTOMERS.filter(customer => customer.review !== null);
  const averageReview = (rated.reduce((sum, customer) => sum + (customer.review ?? 0), 0) / rated.length).toFixed(1);
  useEffect(() => { if (selected) detailsRef.current?.focus(); }, [selected]);

  function handleExport() {
    setExportError('');
    try {
      const url = URL.createObjectURL(new Blob(['\uFEFF', customersToCsv(filtered)], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'balaji-reference-sample-customers.csv';
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setExportError('The sample CSV could not be downloaded. Please try again in your browser.');
    }
  }

  const selectedDetail = selected ? getDetailRecord(selected) : null;

  return (
    <div className="wrapper">
      <div className="admin-heading">
        <div><h1 className="page__header">All customers</h1><p className="page__subtitle">Everyone who has ordered from Balaji Faki Point.</p></div>
        <button type="button" className="btn btn--dark" onClick={handleExport} disabled={filtered.length === 0}>Export CSV</button>
      </div>
      <Notice title="Development reference examples">These eight sample customers and summary figures are from the supplied design, not a live customer database. Filters and CSV export operate on these examples only. Customer access and administration require the future authorized backend.</Notice>
      {exportError && <Notice tone="error">{exportError}</Notice>}
      <div className="stats-grid" aria-label="Reference sample statistics">
        <div className="stat-card"><div className="stat-card__label">Total customers</div><div className="stat-card__value">{SAMPLE_CUSTOMERS.length}</div></div>
        <div className="stat-card"><div className="stat-card__label">New customers</div><div className="stat-card__value">{SAMPLE_CUSTOMERS.filter(customer => customer.status === 'New').length}</div></div>
        <div className="stat-card"><div className="stat-card__label">Repeat customers</div><div className="stat-card__value">{SAMPLE_CUSTOMERS.filter(customer => customer.status === 'Repeat').length}</div></div>
        <div className="stat-card"><div className="stat-card__label">Pending payments</div><div className="stat-card__value">{SAMPLE_CUSTOMERS.filter(customer => customer.status === 'Pending payment').length}</div></div>
        <div className="stat-card"><div className="stat-card__label">Average review</div><div className="stat-card__value">{averageReview}<span style={{ fontSize: 24 }}> / 5</span></div></div>
      </div>
      <div className="card card--tinted customer-filters">
        <div><label htmlFor="cust-search">Search customers</label><input id="cust-search" className="input" type="search" placeholder="Name, phone or area" value={query} onChange={event => setQuery(event.target.value)} /></div>
        <div><label htmlFor="cust-area">Area</label><select id="cust-area" className="input" value={area} onChange={event => setArea(event.target.value)}>{areas.map(location => <option key={location}>{location}</option>)}</select></div>
        <div className="customer-filter-chips" aria-label="Customer status filters">
          {(['all', 'new', 'repeat', 'pending'] as Filter[]).map(status => <button key={status} type="button" className={`chip${filter === status ? ' chip--active' : ''}`} aria-pressed={filter === status} onClick={() => setFilter(status)}>{status === 'all' ? 'All' : status === 'new' ? 'New' : status === 'repeat' ? 'Repeat' : 'Pending payment'}</button>)}
        </div>
      </div>
      <div className="card">
        <div className="customer-table-scroll" role="region" aria-label="Sample customers table" tabIndex={0}>
          <table className="data-table">
            <caption className="sr-only">Development reference customers, not actual customer records</caption>
            <thead><tr>{['Customer', 'Phone', 'Location', 'Orders', 'Total spent', 'Last order', 'Review', 'Status', 'Action'].map(heading => <th scope="col" key={heading}>{heading}</th>)}</tr></thead>
            <tbody>{filtered.map(customer => <tr key={customer.id}>
              <td><div className="review-card__header" style={{ margin: 0 }}><span className="review-avatar">{customer.initials}</span><strong>{customer.name}</strong></div></td>
              <td>{customer.phone}</td>
              <td><span className="review-location"><svg className="icon icon--sm" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s7-6 7-11a7 7 0 10-14 0c0 5 7 11 7 11z" /><circle cx="12" cy="10" r="2.5" /></svg>{customer.location}</span></td>
              <td>{customer.orders}</td><td>Awaiting price</td><td>{customer.lastOrder}</td><td><strong>{customer.review?.toFixed(1) ?? '—'}</strong></td>
              <td><span className={`badge ${STATUS_STYLE[customer.status]}`}>{customer.status}</span></td>
              <td><button type="button" className="text-button" aria-controls="customer-details" aria-expanded={selected?.id === customer.id} onClick={() => setSelected(customer)}>View<span className="sr-only"> sample details for {customer.name}</span></button></td>
            </tr>)}
            {filtered.length === 0 && <tr><td colSpan={9}>No sample customers match these filters.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="pagination">
          <span className="pagination__info" role="status">Showing {filtered.length ? `1–${filtered.length}` : '0'} of {filtered.length} matching sample customers</span>
          <div className="customer-filter-chips"><button type="button" className="btn btn--sm" disabled>Previous</button><button type="button" className="btn btn--sm" disabled>Next</button></div>
        </div>
      </div>
      {selectedDetail && (
        <section ref={detailsRef} tabIndex={-1} id="customer-details" className="card customer-details" aria-labelledby="customer-details-heading">
          <div className="detail-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span className="review-avatar">{selectedDetail.initials}</span>
              <div>
                <h2 id="customer-details-heading" style={{ fontSize: 24 }}>{selectedDetail.name}</h2>
                <p className="text-small text-secondary">Development reference profile · Joined {selectedDetail.joinedDate}</p>
              </div>
            </div>
            <button type="button" className="btn btn--outline btn--sm" onClick={() => setSelected(null)}>Close details</button>
          </div>

          <dl className="admin-kv-grid" style={{ marginTop: 16 }}>
            <div className="admin-kv-item"><dt>Email</dt><dd>{selectedDetail.email}</dd></div>
            <div className="admin-kv-item"><dt>Phone</dt><dd>{selectedDetail.phone}</dd></div>
            <div className="admin-kv-item"><dt>Area &amp; Address</dt><dd>{selectedDetail.fullAddress}</dd></div>
            <div className="admin-kv-item"><dt>Order Count</dt><dd>{selectedDetail.orders}</dd></div>
            <div className="admin-kv-item"><dt>Total Spent</dt><dd>Awaiting price</dd></div>
            <div className="admin-kv-item"><dt>Last Order</dt><dd>{selectedDetail.lastOrder}</dd></div>
          </dl>

          <h3 style={{ fontSize: 18, marginBottom: 10 }}>Customer Order History</h3>
          <div className="customer-table-scroll" style={{ marginBottom: 20 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Order ID</th>
                  <th scope="col">Date</th>
                  <th scope="col">Items</th>
                  <th scope="col">Amount</th>
                  <th scope="col">Payment Status</th>
                  <th scope="col">Order Status</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {selectedDetail.orderHistory.map((ord) => (
                  <tr key={ord.orderId}>
                    <td><strong>{ord.orderNumber}</strong></td>
                    <td>{ord.date}</td>
                    <td>{ord.itemsSummary}</td>
                    <td>Awaiting price</td>
                    <td><span className="badge badge--outline">{ord.paymentStatus}</span></td>
                    <td><span className="badge badge--dark">{ord.orderStatus}</span></td>
                    <td>
                      <Link to={`/admin/orders?orderId=${encodeURIComponent(ord.orderNumber)}`} className="text-button">
                        Inspect order
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3 style={{ fontSize: 18, marginBottom: 10 }}>Customer Reviews</h3>
          {selectedDetail.reviews.length > 0 ? (
            <div className="grid">
              {selectedDetail.reviews.map((rev) => (
                <div key={rev.id} className="review-card">
                  <div className="detail-header">
                    <strong>Order {rev.orderNumber} · {rev.rating}.0 ★</strong>
                    <span className="text-small text-secondary">{rev.createdAt}</span>
                  </div>
                  <p style={{ marginTop: 6 }}>{rev.feedback}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-small text-secondary">No reviews submitted by this customer yet.</p>
          )}
        </section>
      )}
    </div>
  );
}
