import { apiFetch } from '../../lib/api';

export type ReviewProduct = 'faki' | 'supari';

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
  /** Public FastAPI proxy paths for moderated customer photos. */
  photoUrls: string[];
  adminReply?: string | null;
  adminRepliedAt?: string | null;
}

function readReview(value: unknown): PublishedReview {
  if (!value || typeof value !== 'object') throw new Error('The server returned an unreadable review.');
  const review = value as Record<string, unknown>;
  if (
    typeof review.id !== 'string' ||
    typeof review.orderId !== 'string' ||
    typeof review.customerName !== 'string' ||
    typeof review.product !== 'string' ||
    !['faki', 'supari'].includes(review.product) ||
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

export async function getPublishedReviews(product?: ReviewProduct): Promise<PublishedReview[]> {
  const suffix = product ? `?product=${encodeURIComponent(product)}` : '';
  const data = await apiFetch<unknown>(`/reviews${suffix}`);
  if (!data || typeof data !== 'object' || !Array.isArray((data as { items?: unknown }).items)) {
    throw new Error('The server returned an unreadable review list.');
  }
  return (data as { items: unknown[] }).items.map(readReview);
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
