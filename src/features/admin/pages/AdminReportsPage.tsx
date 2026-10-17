import { useEffect, useState } from 'react';
import Notice from '../../../components/common/Notice';
import { env } from '../../../lib/env';
import { formatINR, getErrorMessage } from '../../../lib/api';
import { getAdminReports } from '../api';
import type {
  AdminReportCategory,
  AdminReportResponse,
  AdminReportRow,
  AdminOrderStatus,
  AdminPaymentStatus,
  ProductType,
} from '../types';
import { ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS } from '../lib/orderStateMachine';
import { StatCard, LoadingSkeleton, useAdminToast } from '../components';

const REPORT_CATEGORIES: Array<{ value: AdminReportCategory; label: string }> = [
  { value: 'DAILY_SALES', label: 'Daily Sales' },
  { value: 'WEEKLY_SALES', label: 'Weekly Sales' },
  { value: 'MONTHLY_SALES', label: 'Monthly Sales' },
  { value: 'ORDERS_BY_STATUS', label: 'Orders by Status' },
  { value: 'PRODUCT_SALES', label: 'Product Sales (Faki & Supari)' },
  { value: 'PAYMENT_VERIFICATION_SUMMARY', label: 'Payment Verification Summary' },
  { value: 'REFUND_SUMMARY', label: 'Refund Summary' },
  { value: 'CUSTOMER_SUMMARY', label: 'Customer Summary' },
  { value: 'INVENTORY_SUMMARY', label: 'Inventory Summary' },
];

function buildReferenceReport(category: AdminReportCategory): AdminReportResponse {
  const rowsByCategory: Record<AdminReportCategory, AdminReportRow[]> = {
    DAILY_SALES: [
      { id: 'd-1', periodOrDimension: '15 Oct 2026', ordersCount: 2, verifiedReceiptsAmount: null, deliveredSalesAmount: null, completedRefundsAmount: null, unitsSold: 2, notes: '1 verified, 1 unverified proof excluded' },
      { id: 'd-2', periodOrDimension: '14 Oct 2026', ordersCount: 2, verifiedReceiptsAmount: null, deliveredSalesAmount: null, completedRefundsAmount: null, unitsSold: 4, notes: 'All bank credits verified' },
      { id: 'd-3', periodOrDimension: '12 Oct 2026', ordersCount: 1, verifiedReceiptsAmount: null, deliveredSalesAmount: null, completedRefundsAmount: null, unitsSold: 1, notes: 'Delivered & verified' },
    ],
    WEEKLY_SALES: [
      { id: 'w-1', periodOrDimension: 'Week of 12–18 Oct 2026', ordersCount: 4, verifiedReceiptsAmount: null, deliveredSalesAmount: null, completedRefundsAmount: null, unitsSold: 6, notes: 'Unverified submissions excluded' },
      { id: 'w-2', periodOrDimension: 'Week of 28 Sep–04 Oct 2026', ordersCount: 1, verifiedReceiptsAmount: null, deliveredSalesAmount: null, completedRefundsAmount: null, unitsSold: 1, notes: 'Delivered' },
    ],
    MONTHLY_SALES: [
      { id: 'm-1', periodOrDimension: 'October 2026', ordersCount: 4, verifiedReceiptsAmount: null, deliveredSalesAmount: null, completedRefundsAmount: null, unitsSold: 6, notes: 'Reference period' },
      { id: 'm-2', periodOrDimension: 'September 2026', ordersCount: 1, verifiedReceiptsAmount: null, deliveredSalesAmount: null, completedRefundsAmount: null, unitsSold: 1, notes: 'Reference period' },
    ],
    ORDERS_BY_STATUS: [
      { id: 'os-1', periodOrDimension: 'PAYMENT_REVIEW (Unverified)', ordersCount: 1, verifiedReceiptsAmount: null, deliveredSalesAmount: null, completedRefundsAmount: null, unitsSold: 1, notes: 'Excluded from confirmed sales' },
      { id: 'os-2', periodOrDimension: 'AWAITING_CONFIRMATION', ordersCount: 1, verifiedReceiptsAmount: null, deliveredSalesAmount: null, completedRefundsAmount: null, unitsSold: 1, notes: 'Payment verified' },
      { id: 'os-3', periodOrDimension: 'CONFIRMED', ordersCount: 1, verifiedReceiptsAmount: null, deliveredSalesAmount: null, completedRefundsAmount: null, unitsSold: 2, notes: 'Ready for packing' },
      { id: 'os-4', periodOrDimension: 'OUT_FOR_DELIVERY', ordersCount: 1, verifiedReceiptsAmount: null, deliveredSalesAmount: null, completedRefundsAmount: null, unitsSold: 2, notes: 'In transit' },
      { id: 'os-5', periodOrDimension: 'DELIVERED', ordersCount: 1, verifiedReceiptsAmount: null, deliveredSalesAmount: null, completedRefundsAmount: null, unitsSold: 1, notes: 'Completed sale' },
    ],
    PRODUCT_SALES: [
      { id: 'ps-1', periodOrDimension: 'Faki (ફાકી) · 250 g', ordersCount: 1, verifiedReceiptsAmount: null, deliveredSalesAmount: null, completedRefundsAmount: null, unitsSold: 2 },
      { id: 'ps-2', periodOrDimension: 'Faki (ફાકી) · 500 g', ordersCount: 2, verifiedReceiptsAmount: null, deliveredSalesAmount: null, completedRefundsAmount: null, unitsSold: 3 },
      { id: 'ps-3', periodOrDimension: 'Faki (ફાકી) · 1 kg', ordersCount: 1, verifiedReceiptsAmount: null, deliveredSalesAmount: null, completedRefundsAmount: null, unitsSold: 1 },
      { id: 'ps-4', periodOrDimension: 'Supari (સુપારી) · 250 g', ordersCount: 1, verifiedReceiptsAmount: null, deliveredSalesAmount: null, completedRefundsAmount: null, unitsSold: 1, notes: 'Awaiting payment verification' },
    ],
    PAYMENT_VERIFICATION_SUMMARY: [
      { id: 'pv-1', periodOrDimension: 'VERIFIED (Bank Credit Matched)', ordersCount: 4, verifiedReceiptsAmount: null, deliveredSalesAmount: null, completedRefundsAmount: null, unitsSold: 6 },
      { id: 'pv-2', periodOrDimension: 'SUBMITTED (Unverified Proof)', ordersCount: 1, verifiedReceiptsAmount: null, deliveredSalesAmount: null, completedRefundsAmount: null, unitsSold: 1, notes: 'Zero revenue recognition until verified' },
    ],
    REFUND_SUMMARY: [
      { id: 'rf-1', periodOrDimension: 'PENDING Refunds', ordersCount: 1, verifiedReceiptsAmount: null, deliveredSalesAmount: null, completedRefundsAmount: null, unitsSold: 0 },
      { id: 'rf-2', periodOrDimension: 'COMPLETED Refunds (Bank Verified)', ordersCount: 1, verifiedReceiptsAmount: null, deliveredSalesAmount: null, completedRefundsAmount: null, unitsSold: 0 },
    ],
    CUSTOMER_SUMMARY: [
      { id: 'cs-1', periodOrDimension: 'Repeat Customers', ordersCount: 10, verifiedReceiptsAmount: null, deliveredSalesAmount: null, completedRefundsAmount: null, unitsSold: 10, notes: '2 customers' },
      { id: 'cs-2', periodOrDimension: 'Active / New Customers', ordersCount: 10, verifiedReceiptsAmount: null, deliveredSalesAmount: null, completedRefundsAmount: null, unitsSold: 10, notes: '6 customers' },
    ],
    INVENTORY_SUMMARY: [
      { id: 'is-1', periodOrDimension: 'Faki (All Variants)', ordersCount: 4, verifiedReceiptsAmount: null, deliveredSalesAmount: null, completedRefundsAmount: null, unitsSold: 78, notes: '78 available packs (1kg low stock)' },
      { id: 'is-2', periodOrDimension: 'Supari (All Variants)', ordersCount: 1, verifiedReceiptsAmount: null, deliveredSalesAmount: null, completedRefundsAmount: null, unitsSold: 60, notes: '60 available packs (1kg low stock)' },
    ],
  };

  return {
    category,
    generatedAt: '17 Oct 2026',
    dateFrom: '2026-09-01',
    dateTo: '2026-10-17',
    summary: {
      totalOrders: 5,
      verifiedPaymentReceipts: null,
      deliveredOrderSales: null,
      completedRefunds: null,
      unverifiedSubmissionsExcluded: 1,
    },
    rows: rowsByCategory[category],
  };
}

export function reportRowsToCsv(report: AdminReportResponse, isLive: boolean): string {
  const header = [
    'Data Source',
    'Category',
    'Dimension / Period',
    'Orders Count',
    'Verified Payment Receipts',
    'Delivered Order Sales',
    'Completed Refunds',
    'Units',
    'Notes',
  ];
  const dataRows = report.rows.map((row) => [
    isLive ? 'FastAPI Database Record' : 'Development reference example',
    report.category,
    row.periodOrDimension,
    row.ordersCount,
    formatINR(row.verifiedReceiptsAmount),
    formatINR(row.deliveredSalesAmount),
    formatINR(row.completedRefundsAmount),
    row.unitsSold,
    row.notes ?? '',
  ]);
  return [header, ...dataRows]
    .map((row) =>
      row
        .map((cell) => {
          const text = String(cell);
          const safe = /^[=+\-@\t\r]/.test(text.trimStart()) ? `'${text}` : text;
          return `"${safe.replace(/"/g, '""')}"`;
        })
        .join(','),
    )
    .join('\r\n');
}

export default function AdminReportsPage() {
  const { showToast } = useAdminToast();
  const [category, setCategory] = useState<AdminReportCategory>('DAILY_SALES');
  const [dateFrom, setDateFrom] = useState('2026-09-01');
  const [dateTo, setDateTo] = useState('2026-10-17');
  const [productFilter, setProductFilter] = useState<ProductType | 'ALL'>('ALL');
  const [paymentFilter, setPaymentFilter] = useState<AdminPaymentStatus | 'ALL'>('ALL');
  const [orderStatusFilter, setOrderStatusFilter] = useState<AdminOrderStatus | 'ALL'>('ALL');

  const [report, setReport] = useState<AdminReportResponse>(() =>
    buildReferenceReport('DAILY_SALES'),
  );
  const [loading, setLoading] = useState(Boolean(env.apiBaseUrl));
  const [error, setError] = useState('');
  const [isLive, setIsLive] = useState(false);

  useEffect(() => {
    let active = true;
    if (!env.apiBaseUrl) {
      setReport(buildReferenceReport(category));
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    getAdminReports({
      category,
      dateFrom,
      dateTo,
      product: productFilter,
      paymentStatus: paymentFilter,
      orderStatus: orderStatusFilter,
    })
      .then((res) => {
        if (active) {
          setReport(res);
          setIsLive(true);
        }
      })
      .catch((err) => {
        if (active) setError(getErrorMessage(err));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [category, dateFrom, dateTo, productFilter, paymentFilter, orderStatusFilter]);

  function downloadFile(content: string, filename: string, mimeType: string) {
    try {
      const blob = new Blob(['\uFEFF', content], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      showToast(`Exported ${filename}`, 'success');
    } catch {
      showToast('Export failed in this browser.', 'error');
    }
  }

  function handleExportCsv() {
    const csv = reportRowsToCsv(report, isLive);
    downloadFile(
      csv,
      `balaji-${report.category.toLowerCase()}-${dateFrom}-to-${dateTo}.csv`,
      'text/csv;charset=utf-8',
    );
  }

  function handleExportExcel() {
    const csv = reportRowsToCsv(report, isLive);
    downloadFile(
      csv,
      `balaji-${report.category.toLowerCase()}-${dateFrom}-to-${dateTo}.xls`,
      'application/vnd.ms-excel;charset=utf-8',
    );
  }

  function handlePrintReport() {
    window.print();
  }

  return (
    <div className="wrapper">
      <div className="admin-heading">
        <div>
          <h1 className="page__header">Reports &amp; Financial Exports</h1>
          <p className="page__subtitle">
            Sales, order status, payment verification, refund, customer, and inventory analytics.
          </p>
        </div>
        <div className="admin-action-group no-print">
          <button type="button" className="btn btn--outline btn--sm" onClick={handleExportCsv}>
            Export CSV
          </button>
          <button type="button" className="btn btn--outline btn--sm" onClick={handleExportExcel}>
            Export Excel
          </button>
          <button type="button" className="btn btn--dark btn--sm" onClick={handlePrintReport}>
            Printable Report
          </button>
        </div>
      </div>

      <Notice title="Strict Accounting Rule">
        Customer-submitted payment screenshots and unverified UTRs are <strong>never</strong> counted as confirmed sales. All reporting figures distinguish Verified Payment Receipts, Delivered-Order Sales, and Completed Refunds from actual database records.
      </Notice>

      {error && <Notice tone="error" title="Report generation error">{error}</Notice>}

      <div className="stats-grid">
        <StatCard label="Total Orders in Range" value={report.summary.totalOrders} />
        <StatCard
          label="Verified Payment Receipts"
          value={formatINR(report.summary.verifiedPaymentReceipts)}
          subtitle="Bank-verified credits"
        />
        <StatCard
          label="Delivered-Order Sales"
          value={formatINR(report.summary.deliveredOrderSales)}
          subtitle="Fulfilled & delivered"
        />
        <StatCard
          label="Unverified Proofs Excluded"
          value={report.summary.unverifiedSubmissionsExcluded}
          subtitle="Excluded from revenue"
        />
      </div>

      {/* Report Category & Filters */}
      <div className="card card--tinted customer-filters no-print">
        <div style={{ flex: '2 1 240px' }}>
          <label htmlFor="rep-category">Report Type</label>
          <select
            id="rep-category"
            className="input"
            value={category}
            onChange={(e) => setCategory(e.target.value as AdminReportCategory)}
          >
            {REPORT_CATEGORIES.map((cat) => (
              <option key={cat.value} value={cat.value}>
                {cat.label}
              </option>
            ))}
          </select>
        </div>

        <div style={{ flex: '1 1 150px' }}>
          <label htmlFor="rep-from">From Date</label>
          <input
            id="rep-from"
            type="date"
            className="input"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
        </div>

        <div style={{ flex: '1 1 150px' }}>
          <label htmlFor="rep-to">To Date</label>
          <input
            id="rep-to"
            type="date"
            className="input"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
          />
        </div>

        <div style={{ flex: '1 1 150px' }}>
          <label htmlFor="rep-product">Product</label>
          <select
            id="rep-product"
            className="input"
            value={productFilter}
            onChange={(e) => setProductFilter(e.target.value as ProductType | 'ALL')}
          >
            <option value="ALL">All Products</option>
            <option value="faki">Faki (ફાકી)</option>
            <option value="supari">Supari (સુપારી)</option>
          </select>
        </div>

        <div style={{ flex: '1 1 170px' }}>
          <label htmlFor="rep-pay-status">Payment Status</label>
          <select
            id="rep-pay-status"
            className="input"
            value={paymentFilter}
            onChange={(e) => setPaymentFilter(e.target.value as AdminPaymentStatus | 'ALL')}
          >
            <option value="ALL">All Payment Statuses</option>
            {Object.entries(PAYMENT_STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>

        <div style={{ flex: '1 1 170px' }}>
          <label htmlFor="rep-ord-status">Order Status</label>
          <select
            id="rep-ord-status"
            className="input"
            value={orderStatusFilter}
            onChange={(e) => setOrderStatusFilter(e.target.value as AdminOrderStatus | 'ALL')}
          >
            <option value="ALL">All Order Statuses</option>
            {Object.entries(ORDER_STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
      </div>

      {loading ? (
        <LoadingSkeleton rows={5} />
      ) : (
        <div className="card">
          <div className="detail-header">
            <h2 style={{ fontSize: 22 }}>
              {REPORT_CATEGORIES.find((c) => c.value === category)?.label} ({dateFrom} to {dateTo})
            </h2>
            <span className="badge badge--outline">
              {isLive ? 'Live Database Report' : 'Reference Structure Preview'}
            </span>
          </div>
          <div className="customer-table-scroll" role="region" aria-label="Report breakdown table" tabIndex={0}>
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Period / Dimension</th>
                  <th scope="col">Orders Count</th>
                  <th scope="col">Verified Payment Receipts</th>
                  <th scope="col">Delivered-Order Sales</th>
                  <th scope="col">Completed Refunds</th>
                  <th scope="col">Units</th>
                  <th scope="col">Audit Notes</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((row) => (
                  <tr key={row.id}>
                    <td><strong>{row.periodOrDimension}</strong></td>
                    <td>{row.ordersCount}</td>
                    <td>{formatINR(row.verifiedReceiptsAmount)}</td>
                    <td><strong>{formatINR(row.deliveredSalesAmount)}</strong></td>
                    <td>{formatINR(row.completedRefundsAmount)}</td>
                    <td>{row.unitsSold}</td>
                    <td className="text-small text-secondary">{row.notes ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
