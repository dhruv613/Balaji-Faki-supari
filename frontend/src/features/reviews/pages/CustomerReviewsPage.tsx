import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import Notice from '../../../components/common/Notice';
import { formatPackSize, getErrorMessage, resolveApiUrl } from '../../../lib/api';
import { useSession } from '../../../lib/supabase';
import { getMyOrders } from '../../orders/api/ordersApi';
import type { Order } from '../../../types/orders';
import {
  getPublishedReviews,
  submitReview,
  type PublishedReview,
  type ReviewProduct,
} from '../reviewsApi';

type ProductFilter = 'all' | ReviewProduct;
type ReviewSort = 'newest' | 'highest' | 'lowest';

const MAX_REVIEW_PHOTOS = 5;
const MAX_REVIEW_PHOTO_BYTES = 5 * 1024 * 1024;
const REVIEW_PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export function validateReviewText(reviewText: string): string | null {
  return reviewText.trim().length >= 10 ? null : 'Write at least 10 characters about your purchase.';
}

export function validateReviewPhotos(files: readonly Pick<File, 'name' | 'size' | 'type'>[]): string | null {
  if (files.length > MAX_REVIEW_PHOTOS) return 'Choose no more than 5 photos.';
  for (const file of files) {
    const name = file.name || 'A selected photo';
    if (!REVIEW_PHOTO_TYPES.has(file.type)) return `${name} must be a JPG, PNG, or WEBP image.`;
    if (file.size === 0) return `${name} is empty. Choose a photo with image data.`;
    if (file.size > MAX_REVIEW_PHOTO_BYTES) return `${name} is larger than 5 MB.`;
  }
  return null;
}

function Stars({ rating }: { rating: number }) {
  return <span className="stars" role="img" aria-label={`${rating} out of 5 stars`}>
    {[1, 2, 3, 4, 5].map((star) => <svg key={star} className="icon icon--sm" viewBox="0 0 24 24" aria-hidden="true" style={{ fill: star <= rating ? 'currentColor' : 'none' }}><path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9 6.8 19.7l1-5.9L3.5 9.7l5.9-.8z" /></svg>)}
  </span>;
}

function productLabel(product: ProductFilter): string {
  return product === 'all' ? 'All products' : product === 'faki' ? 'Faki' : 'Supari';
}

export default function CustomerReviewsPage() {
  const { session, loading: authLoading } = useSession();
  const [productFilter, setProductFilter] = useState<ProductFilter>('all');
  const [sort, setSort] = useState<ReviewSort>('newest');
  const [reviews, setReviews] = useState<PublishedReview[]>([]);
  const [eligibleOrders, setEligibleOrders] = useState<Order[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState('');
  const [rating, setRating] = useState(5);
  const [reviewText, setReviewText] = useState('');
  const [reviewPhotos, setReviewPhotos] = useState<File[]>([]);
  const [loadingReviews, setLoadingReviews] = useState(true);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [pageError, setPageError] = useState('');
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const reviewPhotoPreviews = useMemo(() => reviewPhotos.map((file) => ({
    file,
    url: URL.createObjectURL(file),
  })), [reviewPhotos]);

  useEffect(() => () => {
    reviewPhotoPreviews.forEach(({ url }) => URL.revokeObjectURL(url));
  }, [reviewPhotoPreviews]);

  useEffect(() => {
    let active = true;
    setLoadingReviews(true);
    setPageError('');
    getPublishedReviews(productFilter === 'all' ? undefined : productFilter)
      .then((items) => { if (active) setReviews(items); })
      .catch((error) => { if (active) setPageError(getErrorMessage(error)); })
      .finally(() => { if (active) setLoadingReviews(false); });
    return () => { active = false; };
  }, [productFilter]);

  useEffect(() => {
    if (!session) {
      setEligibleOrders([]);
      setSelectedOrderId('');
      return;
    }
    let active = true;
    setLoadingOrders(true);
    getMyOrders()
      .then((orders) => {
        if (!active) return;
        const delivered = orders.filter((order) => order.status === 'DELIVERED');
        setEligibleOrders(delivered);
        setSelectedOrderId((current) => current || delivered[0]?.id || '');
      })
      .catch((error) => { if (active) setFormError(getErrorMessage(error)); })
      .finally(() => { if (active) setLoadingOrders(false); });
    return () => { active = false; };
  }, [session?.user.id]);

  const sortedReviews = useMemo(() => [...reviews].sort((left, right) => {
    if (sort === 'highest') return right.rating - left.rating || Date.parse(right.createdAt) - Date.parse(left.createdAt);
    if (sort === 'lowest') return left.rating - right.rating || Date.parse(right.createdAt) - Date.parse(left.createdAt);
    return Date.parse(right.createdAt) - Date.parse(left.createdAt);
  }), [reviews, sort]);
  const average = reviews.length ? (reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length).toFixed(1) : '0.0';
  const distribution = [5, 4, 3, 2, 1].map((star) => ({ star, count: reviews.filter((review) => review.rating === star).length }));

  function handlePhotoSelection(event: ChangeEvent<HTMLInputElement>) {
    const nextPhotos = [...reviewPhotos, ...Array.from(event.target.files ?? [])];
    event.currentTarget.value = '';
    const validationError = validateReviewPhotos(nextPhotos);
    if (validationError) {
      setFormError(validationError);
      return;
    }
    setReviewPhotos(nextPhotos);
    setFormError('');
  }

  function removePhoto(index: number) {
    setReviewPhotos((current) => current.filter((_, currentIndex) => currentIndex !== index));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validationError = validateReviewText(reviewText);
    const photoValidationError = validateReviewPhotos(reviewPhotos);
    if (!selectedOrderId) {
      setFormError('Choose a delivered order to review.');
      return;
    }
    if (validationError) {
      setFormError(validationError);
      return;
    }
    if (photoValidationError) {
      setFormError(photoValidationError);
      return;
    }
    setSubmitting(true);
    setFormError('');
    setNotice('');
    try {
      await submitReview(selectedOrderId, rating, reviewText.trim(), reviewPhotos);
      setEligibleOrders((current) => current.filter((order) => order.id !== selectedOrderId));
      setSelectedOrderId('');
      setReviewText('');
      setReviewPhotos([]);
      setNotice('Thanks. Your verified-purchase review was submitted for moderation.');
    } catch (error) {
      setFormError(getErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="wrapper reviews-page">
      <h1 className="page__header">Customer reviews</h1>
      <p className="page__subtitle">Verified-purchase feedback for Faki and Supari.</p>

      <div className="reviews-layout">
        <aside className="card card--tinted review-summary" aria-label="Customer review summary">
          <div className="amount-display">{average}</div>
          <div className="review-meta"><Stars rating={Math.round(Number(average))} /><span className="text-small text-secondary">out of 5</span></div>
          <p className="text-small text-secondary">Based on {reviews.length} published {productLabel(productFilter).toLowerCase()} review{reviews.length === 1 ? '' : 's'}</p>
          <div className="rating-bars">
            {distribution.map((item) => <div className="rating-bar" key={item.star}>
              <span>{item.star} stars</span>
              <div className="rating-bar__track"><div className="rating-bar__fill" style={{ width: `${reviews.length ? item.count / reviews.length * 100 : 0}%` }} /></div>
              <span>{item.count}</span>
            </div>)}
          </div>
          <h2 style={{ fontSize: 22, marginTop: 24, marginBottom: 8 }}>Filter reviews</h2>
          <div className="customer-filter-chips" aria-label="Product filters">
            {(['all', 'faki', 'supari'] as const).map((product) => <button key={product} type="button" className={`chip${productFilter === product ? ' chip--active' : ''}`} aria-pressed={productFilter === product} onClick={() => setProductFilter(product)}>{productLabel(product)}</button>)}
          </div>
          <label htmlFor="review-sort" style={{ marginTop: 18 }}>Sort by</label>
          <select id="review-sort" className="input" value={sort} onChange={(event) => setSort(event.target.value as ReviewSort)}>
            <option value="newest">Most recent</option>
            <option value="highest">Highest rated</option>
            <option value="lowest">Lowest rated</option>
          </select>
        </aside>

        <div className="reviews-grid" aria-live="polite">
          {loadingReviews && <p className="text-secondary">Loading published reviews…</p>}
          {pageError && <Notice tone="warning" title="Reviews are unavailable">{pageError}</Notice>}
          {!loadingReviews && !pageError && sortedReviews.length === 0 && <p className="text-secondary">No published reviews for this product yet.</p>}
          {sortedReviews.map((review) => <article className="review-card" key={review.id}>
            <div className="review-card__header">
              <span className="review-avatar">{review.customerName.split(' ').map((part) => part[0]).join('').slice(0, 2)}</span>
              <div><strong>{review.customerName}</strong><p className="review-location text-small text-secondary">{review.area || 'Rajkot'}</p></div>
            </div>
            <div className="review-meta"><Stars rating={review.rating} /><strong>{review.rating}.0</strong><span className="text-small text-secondary">· {new Date(review.createdAt).toLocaleDateString('en-IN')}</span></div>
            <p style={{ margin: '12px 0' }}>{review.reviewText}</p>
            <div className="review-footer"><span className="text-small text-secondary">{review.productName} · {formatPackSize(review.packSize)}</span>{review.verifiedPurchase && <span className="badge">Verified purchase</span>}</div>
            {review.photoUrls.length > 0 && <div className="review-photo-grid" aria-label="Customer review photos">
              {review.photoUrls.map((photoUrl, index) => <img key={photoUrl} src={resolveApiUrl(photoUrl)} alt={`Customer photo ${index + 1} for ${review.productName}`} loading="lazy" />)}
            </div>}
            {review.adminReply && <div className="card card--tinted" style={{ marginTop: 12 }}><strong>Balaji Faki Point</strong><p className="text-small" style={{ marginTop: 4 }}>{review.adminReply}</p></div>}
          </article>)}
        </div>
      </div>

      <section className="card card--tinted review-feedback" aria-labelledby="feedback-heading">
        <h2 id="feedback-heading" style={{ fontSize: 24 }}>Write a review</h2>
        <p className="text-secondary" style={{ margin: '8px 0 20px' }}>Only delivered orders can be reviewed. Reviews are published after store moderation.</p>
        {authLoading && <p role="status">Checking your sign-in…</p>}
        {!authLoading && !session && <Notice title="Sign in to review a purchase">Open <Link to="/my-orders">My Orders</Link> to sign in and choose a delivered order.</Notice>}
        {!authLoading && session && loadingOrders && <p role="status">Checking your delivered orders…</p>}
        {!authLoading && session && !loadingOrders && eligibleOrders.length === 0 && <Notice title="No delivered order available">A review becomes available after an order is marked Delivered.</Notice>}
        {!authLoading && session && !loadingOrders && eligibleOrders.length > 0 && <form noValidate onSubmit={handleSubmit}>
          <label htmlFor="review-order">Delivered order</label>
          <select id="review-order" className="input" value={selectedOrderId} onChange={(event) => setSelectedOrderId(event.target.value)} required>
            {eligibleOrders.map((order) => <option value={order.id} key={order.id}>{order.orderNumber} · {order.productName} · {formatPackSize(order.packSize)}</option>)}
          </select>
          <fieldset style={{ margin: '20px 0 16px' }}>
            <legend>Your rating (5 = excellent)</legend>
            <div className="rating-selector">{[1, 2, 3, 4, 5].map((value) => <button key={value} type="button" className={`rating-btn${rating === value ? ' rating-btn--selected' : ''}`} aria-label={`${value} ${value === 1 ? 'star' : 'stars'}`} aria-pressed={rating === value} onClick={() => setRating(value)}>{value}</button>)}</div>
          </fieldset>
          <label htmlFor="review-text">Your review</label>
          <textarea id="review-text" className="input" value={reviewText} onChange={(event) => setReviewText(event.target.value)} maxLength={2000} placeholder="What did you like? What can we do better?" required aria-invalid={!!validateReviewText(reviewText)} />
          <label htmlFor="review-photos" style={{ marginTop: 16 }}>Photos (optional)</label>
          <p id="review-photos-help" className="text-small text-secondary" style={{ margin: '4px 0 8px' }}>Add up to 5 JPG, PNG, or WEBP photos. Each photo must be 5 MB or smaller.</p>
          <input id="review-photos" className="input" type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" multiple aria-describedby="review-photos-help" onChange={handlePhotoSelection} disabled={submitting} />
          {reviewPhotoPreviews.length > 0 && <ul className="review-selected-photos" aria-label="Selected review photos">
            {reviewPhotoPreviews.map(({ file, url }, index) => <li key={`${file.name}-${index}`} className="review-selected-photo">
              <img src={url} alt={`Preview of ${file.name}`} />
              <span className="text-small">{file.name}</span>
              <button type="button" className="btn btn--outline btn--sm" onClick={() => removePhoto(index)} disabled={submitting} aria-label={`Remove ${file.name}`}>Remove</button>
            </li>)}
          </ul>}
          {formError && <Notice tone="warning" title="Review not submitted">{formError}</Notice>}
          {notice && <Notice title="Review submitted">{notice}</Notice>}
          <button type="submit" className="btn btn--primary" disabled={submitting}>{submitting ? 'Submitting…' : 'Submit review'}</button>
        </form>}
      </section>
    </div>
  );
}
