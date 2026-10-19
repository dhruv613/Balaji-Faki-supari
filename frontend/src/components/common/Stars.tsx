/** Star row for a whole-number rating, or a decimal average (partial stars are rounded to the nearest half). */
export default function Stars({ rating, label }: { rating: number; label?: string }) {
  const rounded = Math.round(rating * 2) / 2;
  return (
    <span className="stars" role="img" aria-label={label ?? `${rating} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((star) => (
        <svg key={star} className="icon icon--sm" viewBox="0 0 24 24" aria-hidden="true"
          style={{ fill: star <= rounded ? 'currentColor' : 'none', opacity: star - 0.5 === rounded ? 0.55 : 1 }}>
          <path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9 6.8 19.7l1-5.9L3.5 9.7l5.9-.8z" />
        </svg>
      ))}
    </span>
  );
}

/** "4.5 · 12 reviews" or "No reviews yet" - never a made-up number. */
export function RatingLine({ average, count }: { average?: number | null; count?: number }) {
  if (!count || average == null) return <span className="text-small text-secondary">No reviews yet</span>;
  return (
    <span className="rating-line">
      <Stars rating={average} label={`Average rating ${average} out of 5 from ${count} ${count === 1 ? 'review' : 'reviews'}`} />
      <span className="text-small"> <strong>{average.toFixed(1)}</strong> · {count} {count === 1 ? 'review' : 'reviews'}</span>
    </span>
  );
}
