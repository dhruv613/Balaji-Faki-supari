import { useEffect, useState, type FormEvent } from 'react';
import Notice from '@shared/components/common/Notice';
import { env } from '@shared/lib/env';
import { formatPackSize, getErrorMessage, resolveApiUrl } from '@shared/lib/api';
import { getAdminReviews, updateAdminReview } from '../api';
import type { AdminReviewRecord, ReviewModerationStatus } from '../types';
import {
  StatCard,
  StatusBadge,
  DetailDrawer,
  LoadingSkeleton,
  useAdminToast,
} from '../components';

function isReviewPhotoProxyPath(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('/api/');
}

export default function AdminReviewsPage() {
  const { showToast } = useAdminToast();
  const [reviews, setReviews] = useState<AdminReviewRecord[]>([]);
  const [query, setQuery] = useState('');
  const [ratingFilter, setRatingFilter] = useState<number | 'ALL'>('ALL');
  const [modFilter, setModFilter] = useState<ReviewModerationStatus | 'ALL'>('ALL');
  const [selectedReview, setSelectedReview] = useState<AdminReviewRecord | null>(null);
  const [replyText, setReplyText] = useState('');
  const [busy, setBusy] = useState(false);
  const [hideCategory, setHideCategory] = useState('');
  const [hideDetail, setHideDetail] = useState('');

  const [loading, setLoading] = useState(Boolean(env.apiBaseUrl));
  const [error, setError] = useState('');
  const [isLive, setIsLive] = useState(false);

  useEffect(() => {
    let active = true;
    if (!env.apiBaseUrl) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    getAdminReviews({
      search: query || undefined,
      rating: ratingFilter,
      moderationStatus: modFilter,
    })
      .then((res) => {
        if (active) {
          setReviews(res.items);
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
  }, [query, ratingFilter, modFilter]);

  const filtered = reviews.filter((r) => {
    if (ratingFilter !== 'ALL' && r.rating !== ratingFilter) return false;
    if (modFilter !== 'ALL' && r.moderationStatus !== modFilter) return false;
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return `${r.customerName} ${r.orderNumber} ${r.productName} ${r.area} ${r.reviewText}`
      .toLowerCase()
      .includes(q);
  });

  // The public average counts published reviews only; hidden reviews stay visible here for audit.
  const published = reviews.filter((r) => r.moderationStatus === 'PUBLISHED');
  const avgRating =
    published.length > 0
      ? (published.reduce((sum, r) => sum + r.rating, 0) / published.length).toFixed(1)
      : '0.0';

  function openReviewDrawer(review: AdminReviewRecord) {
    setSelectedReview(review);
    setReplyText(review.adminReply ?? '');
  }

  async function handleModerationUpdate(nextStatus: ReviewModerationStatus) {
    if (!selectedReview) return;
    if (!env.apiBaseUrl) return;
    const reason = [hideCategory, hideDetail.trim()].filter(Boolean).join(': ');
    if (nextStatus === 'HIDDEN' && (!hideCategory || reason.length < 3)) {
      showToast('Choose a reason for hiding this review (spam, abuse, private information or prohibited content).', 'warning');
      return;
    }
    setBusy(true);
    try {
      const updated = await updateAdminReview(selectedReview.id, {
        moderationStatus: nextStatus,
        ...(nextStatus === 'HIDDEN' ? { moderationReason: reason } : {}),
      });
      setReviews((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
      setSelectedReview(updated);
      setHideCategory('');
      setHideDetail('');
      showToast(nextStatus === 'HIDDEN' ? 'Review hidden. It stays in admin history.' : 'Review is public again.', 'success');
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveReply(e: FormEvent) {
    e.preventDefault();
    if (!selectedReview || !env.apiBaseUrl || busy) return;
    setBusy(true);
    try {
      // Only the reply is sent: saving a reply never changes (or re-asserts) the review visibility.
      const updated = await updateAdminReview(selectedReview.id, { adminReply: replyText.trim() });
      setReviews((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
      setSelectedReview(updated);
      showToast('Reply saved.', 'success');
    } catch (err) {
      showToast(getErrorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="wrapper">
      <div className="admin-heading">
        <div>
          <h1 className="page__header">Feedback Management</h1>
          <p className="page__subtitle">
            View customer feedback, star ratings, and order details; reply to reviews and moderate visibility.
          </p>
        </div>
      </div>

      <Notice title="Review Integrity &amp; Moderation Policy">
        Only eligible <strong>DELIVERED</strong> orders are allowed to submit verified-purchase reviews. Genuine customer feedback must never be deleted merely because it is critical or negative — use Admin Replies to address customer concerns transparently.
      </Notice>

      {!isLive && (
        <Notice tone="info" title="Review data unavailable">
          Connect the local FastAPI server to manage real customer reviews. No sample reviews are shown here.
        </Notice>
      )}
      {error && <Notice tone="error" title="Reviews sync failed">{error}</Notice>}

      <div className="stats-grid">
        <StatCard label="Total Feedback" value={reviews.length} />
        <StatCard label="Average Rating" value={`${avgRating} / 5`} />
        <StatCard
          label="Published Reviews"
          value={reviews.filter((r) => r.moderationStatus === 'PUBLISHED').length}
        />
        <StatCard
          label="Pending / Hidden"
          value={reviews.filter((r) => r.moderationStatus !== 'PUBLISHED').length}
        />
      </div>

      {/* Filters */}
      <div className="card card--tinted customer-filters">
        <div style={{ flex: '2 1 260px' }}>
          <label htmlFor="rev-admin-search">Search Feedback by Customer, Order ID, Area, or Text</label>
          <input
            id="rev-admin-search"
            type="search"
            className="input"
            placeholder="Hetal P., #BFP-1039, Kalawad Road…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div style={{ flex: '1 1 160px' }}>
          <label htmlFor="rev-rating-filter">Filter by Rating</label>
          <select
            id="rev-rating-filter"
            className="input"
            value={ratingFilter}
            onChange={(e) =>
              setRatingFilter(e.target.value === 'ALL' ? 'ALL' : Number(e.target.value))
            }
          >
            <option value="ALL">All Ratings</option>
            <option value="5">5 Stars (★★★★★)</option>
            <option value="4">4 Stars (★★★★☆)</option>
            <option value="3">3 Stars (★★★☆☆)</option>
            <option value="2">2 Stars (★★☆☆☆)</option>
            <option value="1">1 Star (★☆☆☆☆)</option>
          </select>
        </div>

        <div className="customer-filter-chips" aria-label="Moderation status filters">
          {(['ALL', 'PUBLISHED', 'PENDING_MODERATION', 'HIDDEN'] as const).map((st) => (
            <button
              key={st}
              type="button"
              className={`chip${modFilter === st ? ' chip--active' : ''}`}
              aria-pressed={modFilter === st}
              onClick={() => setModFilter(st)}
            >
              {st === 'ALL'
                ? 'All'
                : st === 'PUBLISHED'
                ? 'Published'
                : st === 'PENDING_MODERATION'
                ? 'Pending'
                : 'Hidden'}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <LoadingSkeleton rows={4} />
      ) : (
        <div className="card">
          <div className="admin-table-wrap" role="region" aria-label="Customer feedback table" tabIndex={0}>
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Customer &amp; Area</th>
                  <th scope="col">Order ID</th>
                  <th scope="col">Product</th>
                  <th scope="col">Star Rating</th>
                  <th scope="col">Feedback</th>
                  <th scope="col">Date</th>
                  <th scope="col">Status</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((rev) => (
                  <tr key={rev.id}>
                    <td>
                      <strong>{rev.customerName}</strong>
                      <p className="text-small text-secondary">{rev.area}</p>
                    </td>
                    <td>
                      <strong>{rev.orderNumber}</strong>
                      {rev.isEligibleDeliveredOrder && (
                        <p className="text-small" style={{ color: 'var(--color-green)' }}>
                          ✓ Delivered Order
                        </p>
                      )}
                    </td>
                    <td>
                      {rev.productName} · {formatPackSize(rev.packSize)}
                    </td>
                    <td>
                      <strong aria-label={`${rev.rating} out of 5 stars`}>
                        {'★'.repeat(rev.rating)}
                        {'☆'.repeat(Math.max(0, 5 - rev.rating))} ({rev.rating}.0)
                      </strong>
                    </td>
                    <td style={{ maxWidth: 320 }}>
                      <p className="text-small">{rev.reviewText}</p>
                      {rev.adminReply && (
                        <p className="text-small text-secondary" style={{ marginTop: 4 }}>
                          <strong>Admin reply:</strong> {rev.adminReply}
                        </p>
                      )}
                    </td>
                    <td className="text-small">{rev.createdAt}</td>
                    <td><StatusBadge status={rev.moderationStatus} /></td>
                    <td>
                      <button
                        type="button"
                        className="btn btn--outline btn--sm"
                        onClick={() => openReviewDrawer(rev)}
                      >
                        View / Reply
                      </button>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={8} className="text-secondary">
                      No feedback entries match these filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Review Detail & Moderation Drawer */}
      <DetailDrawer
        open={selectedReview !== null}
        title={
          selectedReview
            ? `Review for ${selectedReview.orderNumber}`
            : 'Review Moderation'
        }
        subtitle={
          selectedReview
            ? `${selectedReview.customerName} · ${selectedReview.area} · ${selectedReview.createdAt}`
            : undefined
        }
        onClose={() => setSelectedReview(null)}
      >
        {selectedReview && (
          <div>
            <dl className="admin-kv-grid">
              <div className="admin-kv-item">
                <dt>Customer</dt>
                <dd>{selectedReview.customerName}</dd>
              </div>
              <div className="admin-kv-item">
                <dt>Order ID</dt>
                <dd>{selectedReview.orderNumber}</dd>
              </div>
              <div className="admin-kv-item">
                <dt>Product &amp; Pack</dt>
                <dd>
                  {selectedReview.productName} · {formatPackSize(selectedReview.packSize)}
                </dd>
              </div>
              <div className="admin-kv-item">
                <dt>Rating</dt>
                <dd>{selectedReview.rating}.0 / 5 ★</dd>
              </div>
              <div className="admin-kv-item">
                <dt>Delivered Order Eligibility</dt>
                <dd>
                  {selectedReview.isEligibleDeliveredOrder
                    ? '✓ Eligible Delivered Order'
                    : 'Unverified Order'}
                </dd>
              </div>
              <div className="admin-kv-item">
                <dt>Moderation Status</dt>
                <dd><StatusBadge status={selectedReview.moderationStatus} /></dd>
              </div>
            </dl>

            <div className="card card--tinted" style={{ marginBottom: 20 }}>
              <h3 style={{ fontSize: 16, marginBottom: 6 }}>Customer Feedback</h3>
              <p>{selectedReview.reviewText}</p>
            </div>

            {(selectedReview.photoUrls ?? []).filter(isReviewPhotoProxyPath).length > 0 && (
              <section className="card card--tinted" style={{ marginBottom: 20 }} aria-labelledby="admin-review-photos-heading">
                <h3 id="admin-review-photos-heading" style={{ fontSize: 16, marginBottom: 10 }}>Customer Photos</h3>
                <div className="review-photo-grid">
                  {(selectedReview.photoUrls ?? []).filter(isReviewPhotoProxyPath).map((photoUrl, index) => (
                    <img key={photoUrl} src={resolveApiUrl(photoUrl)} alt={`Customer review photo ${index + 1}`} loading="lazy" />
                  ))}
                </div>
              </section>
            )}

            <form className="card" style={{ marginBottom: 20 }} onSubmit={handleSaveReply}>
              <label htmlFor="admin-reply-input">Official Store Reply</label>
              <textarea
                id="admin-reply-input"
                className="input"
                placeholder="Write a polite, helpful response from Balaji Faki Point…"
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                disabled={busy}
              />
              <button
                type="submit"
                className="btn btn--primary btn--sm"
                style={{ marginTop: 12 }}
                disabled={busy}
              >
                Save Admin Reply
              </button>
            </form>

            <div className="card">
              <h3 style={{ fontSize: 16, marginBottom: 6 }}>Visibility &amp; Moderation</h3>
              <p className="text-small text-secondary" style={{ marginBottom: 12 }}>
                Genuine negative reviews must stay public. Hide a review only for spam, abuse, private information or prohibited content; the reason is recorded and the review stays in admin history.
              </p>
              {selectedReview.moderationStatus === 'HIDDEN' && (
                <Notice tone="warning" title="Hidden from customers">
                  Reason on record: {selectedReview.moderationReason || 'not recorded'}. This review is excluded from the public rating and count.
                </Notice>
              )}
              {selectedReview.moderationStatus !== 'HIDDEN' && (
                <div style={{ marginBottom: 12 }}>
                  <label htmlFor="hide-category">Reason to hide (required)</label>
                  <select id="hide-category" className="input" value={hideCategory} onChange={(e) => setHideCategory(e.target.value)} disabled={busy}>
                    <option value="">Choose a reason…</option>
                    <option value="Spam">Spam</option>
                    <option value="Abuse">Abusive language</option>
                    <option value="Private information">Contains private information</option>
                    <option value="Prohibited content">Prohibited content</option>
                  </select>
                  <label htmlFor="hide-detail" style={{ marginTop: 8 }}>Details for the audit log (optional)</label>
                  <input id="hide-detail" className="input" value={hideDetail} onChange={(e) => setHideDetail(e.target.value)} maxLength={300} disabled={busy} />
                </div>
              )}
              <div className="admin-action-group">
                <button
                  type="button"
                  className="btn btn--dark btn--sm"
                  disabled={busy || selectedReview.moderationStatus === 'PUBLISHED'}
                  onClick={() => handleModerationUpdate('PUBLISHED')}
                >
                  Make Public Again
                </button>
                <button
                  type="button"
                  className="btn btn--outline btn--sm"
                  disabled={busy || selectedReview.moderationStatus === 'HIDDEN' || !hideCategory}
                  onClick={() => handleModerationUpdate('HIDDEN')}
                >
                  Hide Review
                </button>
              </div>
            </div>
          </div>
        )}
      </DetailDrawer>
    </div>
  );
}
