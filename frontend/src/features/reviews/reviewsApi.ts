import { apiFetch } from '../../lib/api';
import { PRODUCT_SLUG_PATTERN } from '../../constants/store';

export type ReviewProduct = string; // product slug from the catalogue
export type ReviewSort = 'newest' | 'oldest' | 'highest' | 'lowest';

export interface PublishedReview {
  id: string;
  orderId: string;
  customerName: string;
  area: string;
  product: ReviewProduct;
  productName: string;
  packSize: string;
  rating: number;
  reviewText: string;
  verifiedPurchase: boolean;
  createdAt: string;
  /** Public FastAPI proxy paths for customer photos of published reviews. */
  photoUrls: string[];
  adminReply?: string | null;
  adminRepliedAt?: string | null;
}

/** Published reviews only: hidden reviews are excluded from the average, count and distribution. */
export interface ReviewSummary {
  average: number | null;
  count: number;
  distribution: Record<'1' | '2' | '3' | '4' | '5', number>;
}

export interface ReviewList {
  items: PublishedReview[];
  summary: ReviewSummary;
}

function readReview(value: unknown): PublishedReview {
  if (!value || typeof value !== 'object') throw new Error('The server returned an unreadable review.');
  const review = value as Record<string, unknown>;
  if (
    typeof review.id !== 'string' ||
    typeof review.orderId !== 'string' ||
    typeof review.customerName !== 'string' ||
    typeof review.product !== 'string' ||
    !PRODUCT_SLUG_PATTERN.test(review.product) ||
    typeof review.rating !== 'number' ||
    review.rating < 1 ||
    review.rating > 5 ||
    typeof review.reviewText !== 'string' ||
    typeof review.createdAt !== 'string'
  ) {
    throw new Error('The server returned an unreadable review.');
  }
  const photoUrls = review.photoUrls ?? [];
  if (
    !Array.isArray(photoUrls) ||
    !photoUrls.every((photoUrl) => typeof photoUrl === 'string' && photoUrl.startsWith('/api/'))
  ) {
    throw new Error('The server returned an unreadable review photo.');
  }
  return { ...review, photoUrls } as unknown as PublishedReview;
}

export function readReviewSummary(value: unknown): ReviewSummary {
  const summary = value as Partial<ReviewSummary> | null;
  const distribution = summary?.distribution as Record<string, unknown> | undefined;
  if (
    !summary || typeof summary.count !== 'number' || !distribution ||
    !(summary.average === null || typeof summary.average === 'number') ||
    !['1', '2', '3', '4', '5'].every((star) => typeof distribution[star] === 'number')
  ) {
    throw new Error('The server returned an unreadable review summary.');
  }
  return summary as ReviewSummary;
}

export async function getPublishedReviews(product?: ReviewProduct, sort: ReviewSort = 'newest'): Promise<ReviewList> {
  const query = new URLSearchParams({ sort });
  if (product) query.set('product', product);
  const data = await apiFetch<unknown>(`/reviews?${query.toString()}`);
  if (!data || typeof data !== 'object' || !Array.isArray((data as { items?: unknown }).items)) {
    throw new Error('The server returned an unreadable review list.');
  }
  return {
    items: (data as { items: unknown[] }).items.map(readReview),
    summary: readReviewSummary((data as { summary?: unknown }).summary),
  };
}

export async function submitReview(
  orderId: string,
  rating: number,
  reviewText: string,
  photos: readonly File[] = [],
): Promise<PublishedReview> {
  const formData = new FormData();
  formData.append('rating', String(rating));
  formData.append('reviewText', reviewText);
  photos.forEach((photo) => formData.append('photos', photo));
  return readReview(await apiFetch<unknown>(`/orders/${encodeURIComponent(orderId)}/review`, {
    method: 'POST',
    body: formData,
  }));
}
