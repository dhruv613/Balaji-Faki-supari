import { useRef, useState, type FormEvent } from 'react';
import Notice from '../../../components/common/Notice';
import type { CustomerReview } from '../../../types/orders';

// Reference examples only; replace with authenticated FastAPI review data.
const SAMPLE_REVIEWS: CustomerReview[] = [
  { id: '1', customerName: 'Hetal P.', area: 'Kalawad Road, Rajkot', rating: 5, feedback: 'Ordered online, paid by QR and got my confirmation quickly. Packing was neat.', product: 'Faki', packSize: '500 g', verified: false, createdAt: '12 Oct 2026' },
  { id: '2', customerName: 'Rahul M.', area: 'University Road, Rajkot', rating: 5, feedback: 'Easy order form, and tracking showed every step until delivery.', product: 'Supari', packSize: '250 g', verified: false, createdAt: '9 Oct 2026' },
  { id: '3', customerName: 'Jignesh S.', area: 'Raiya Road, Rajkot', rating: 4, feedback: 'Good quality. Payment verification took a little while, but the team called me.', product: 'Faki', packSize: '1 kg', verified: false, createdAt: '3 Oct 2026' },
  { id: '4', customerName: 'Pooja D.', area: 'Mavdi, Rajkot', rating: 5, feedback: 'Reordering from My Orders was simple. Will order again.', product: 'Faki', packSize: '250 g', verified: false, createdAt: '28 Sep 2026' },
  { id: '5', customerName: 'Nilesh B.', area: 'Gondal Road, Rajkot', rating: 5, feedback: 'Visited the store first, then ordered online for my family.', product: 'Supari', packSize: '500 g', verified: false, createdAt: '21 Sep 2026' },
  { id: '6', customerName: 'Dipti K.', area: '150 Feet Ring Road, Rajkot', rating: 4, feedback: 'Delivery was on time. I\'d like to see more pack sizes.', product: 'Faki', packSize: '500 g', verified: false, createdAt: '15 Sep 2026' },
];

const AREAS = ['All areas', 'University Road', 'Kalawad Road', 'Raiya Road', 'Mavdi', 'Gondal Road', '150 Feet Ring Road'];

function getInitials(name: string) {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

type FeedbackFields = { name: string; area: string; feedback: string };

export function validateFeedback(fields: FeedbackFields): Partial<Record<keyof FeedbackFields, string>> {
  const errors: Partial<Record<keyof FeedbackFields, string>> = {};
  if (fields.name.trim().length < 2) errors.name = 'Enter your name (at least 2 characters).';
  if (fields.area.trim().length < 2) errors.area = 'Enter your area (at least 2 characters).';
  if (fields.feedback.trim().length < 10) errors.feedback = 'Write at least 10 characters of feedback.';
  return errors;
}

function Stars({ rating }: { rating: number }) {
  return <span className="stars" role="img" aria-label={`${rating} out of 5 stars`}>
    {[1, 2, 3, 4, 5].map(star => <svg key={star} className="icon icon--sm" viewBox="0 0 24 24" aria-hidden="true" style={{ fill: star <= rating ? 'currentColor' : 'none' }}><path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9 6.8 19.7l1-5.9L3.5 9.7l5.9-.8z" /></svg>)}
  </span>;
}

export default function CustomerReviewsPage() {
  const [areaFilter, setAreaFilter] = useState('All areas');
  const [formRating, setFormRating] = useState(5);
  const [errors, setErrors] = useState<ReturnType<typeof validateFeedback>>({});
  const [notice, setNotice] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);
  const avgRating = (SAMPLE_REVIEWS.reduce((sum, review) => sum + review.rating, 0) / SAMPLE_REVIEWS.length).toFixed(1);
  const filtered = SAMPLE_REVIEWS.filter(review => areaFilter === 'All areas' || review.area === `${areaFilter}, Rajkot`);
  const distribution = [5, 4, 3, 2, 1].map(star => ({ star, count: SAMPLE_REVIEWS.filter(review => review.rating === star).length }));

  function handleFeedback(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const found = validateFeedback({ name: String(data.get('name') ?? ''), area: String(data.get('area') ?? ''), feedback: String(data.get('feedback') ?? '') });
    setErrors(found);
    setNotice('');
    const firstInvalid = Object.keys(found)[0];
    if (firstInvalid) {
      (form.elements.namedItem(firstInvalid) as HTMLElement | null)?.focus();
      return;
    }
    setNotice('Feedback has not been sent. Review submission is not connected yet. Your entered details remain here; please contact the store to share feedback.');
  }

  return (
    <div className="wrapper reviews-page">
      <h1 className="page__header">Customer reviews</h1>
      <p className="page__subtitle">Feedback from our customers, with the area they order from.</p>
      <Notice title="Development reference examples">The reviews, ratings and names below come from the supplied design. They are sample content, not actual customer reviews or verified orders. Live reviews are not connected yet.</Notice>

      <div className="reviews-layout">
        <aside className="card card--tinted review-summary" aria-label="Sample review summary">
          <div className="amount-display">{avgRating}</div>
          <div className="review-meta"><Stars rating={Math.round(Number(avgRating))} /><span className="text-small text-secondary">out of 5</span></div>
          <p className="text-small text-secondary">Based on {SAMPLE_REVIEWS.length} reference examples</p>
          <div className="rating-bars">
            {distribution.map(item => <div className="rating-bar" key={item.star}>
              <span>{item.star} stars</span>
              <div className="rating-bar__track"><div className="rating-bar__fill" style={{ width: `${item.count / SAMPLE_REVIEWS.length * 100}%` }} /></div>
              <span>{item.count}</span>
            </div>)}
          </div>
          <h2 style={{ fontSize: 22, marginTop: 24, marginBottom: 8 }}>Filter by location</h2>
          <div className="customer-filter-chips">
            {AREAS.map(area => <button key={area} type="button" className={`chip${areaFilter === area ? ' chip--active' : ''}`} aria-pressed={areaFilter === area} onClick={() => setAreaFilter(area)}>{area}</button>)}
          </div>
          <button type="button" className="btn btn--primary btn--full" style={{ marginTop: 16 }} onClick={() => nameRef.current?.focus()}>Write a review</button>
        </aside>
        <div className="reviews-grid" aria-live="polite">
          {filtered.map(review => <article className="review-card" key={review.id}>
            <div className="review-card__header">
              <span className="review-avatar">{getInitials(review.customerName)}</span>
              <div><strong>{review.customerName}</strong><p className="review-location text-small text-secondary"><svg className="icon icon--sm" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s7-6 7-11a7 7 0 10-14 0c0 5 7 11 7 11z" /><circle cx="12" cy="10" r="2.5" /></svg>{review.area}</p></div>
            </div>
            <div className="review-meta"><Stars rating={review.rating} /><strong>{review.rating}.0</strong><span className="text-small text-secondary">· {review.createdAt}</span></div>
            <p style={{ margin: '12px 0' }}>{review.feedback}</p>
            <div className="review-footer"><span className="text-small text-secondary">{review.product} · {review.packSize}</span><span className="badge">Reference example</span></div>
          </article>)}
          {filtered.length === 0 && <p className="text-secondary">No reference examples for this area.</p>}
        </div>
      </div>

      <section className="card card--tinted review-feedback" aria-labelledby="feedback-heading">
        <h2 id="feedback-heading" style={{ fontSize: 24 }}>Share your feedback</h2>
        <p className="text-secondary" style={{ margin: '8px 0 20px' }}>Tell us about your order — it helps other customers and helps us improve.</p>
        <form noValidate onSubmit={handleFeedback}>
          <div className="review-form-grid">
            <div><label htmlFor="rev-name">Your name</label><input ref={nameRef} id="rev-name" name="name" className={`input${errors.name ? ' input--error' : ''}`} autoComplete="name" maxLength={100} placeholder="e.g. Hetal Patel" required aria-invalid={!!errors.name} aria-describedby={errors.name ? 'rev-name-error' : undefined} />{errors.name && <p className="field-error" id="rev-name-error">{errors.name}</p>}</div>
            <div><label htmlFor="rev-area">Your area</label><input id="rev-area" name="area" className={`input${errors.area ? ' input--error' : ''}`} maxLength={120} placeholder="e.g. Kalawad Road" required aria-invalid={!!errors.area} aria-describedby={errors.area ? 'rev-area-error' : undefined} />{errors.area && <p className="field-error" id="rev-area-error">{errors.area}</p>}</div>
            <div><label htmlFor="rev-order">Order ID (optional)</label><input id="rev-order" name="orderId" className="input" maxLength={80} placeholder="#BFP-1042" /></div>
          </div>
          <fieldset style={{ margin: '20px 0 16px' }}>
            <legend>Your rating (5 = excellent)</legend>
            <div className="rating-selector">{[1, 2, 3, 4, 5].map(rating => <button key={rating} type="button" className={`rating-btn${formRating === rating ? ' rating-btn--selected' : ''}`} aria-label={`${rating} ${rating === 1 ? 'star' : 'stars'}`} aria-pressed={formRating === rating} onClick={() => setFormRating(rating)}>{rating}</button>)}</div>
          </fieldset>
          <label htmlFor="rev-feedback">Your feedback</label>
          <textarea id="rev-feedback" name="feedback" className={`input${errors.feedback ? ' input--error' : ''}`} maxLength={2000} placeholder="What did you like? What can we do better?" required aria-invalid={!!errors.feedback} aria-describedby={errors.feedback ? 'rev-feedback-error' : undefined} />
          {errors.feedback && <p className="field-error" id="rev-feedback-error">{errors.feedback}</p>}
          <div className="checkbox-row"><input type="checkbox" id="rev-show-name" name="showName" defaultChecked /><label htmlFor="rev-show-name" style={{ marginBottom: 0, fontWeight: 400 }}>Show my first name and area with my review</label></div>
          {notice && <Notice tone="warning" title="Review submission is not connected">{notice}</Notice>}
          <button type="submit" className="btn btn--primary">Submit feedback</button>
        </form>
      </section>
    </div>
  );
}
