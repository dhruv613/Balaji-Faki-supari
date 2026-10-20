/**
 * Shared API utilities and placeholder product data.
 *
 * All real API calls will go through FastAPI. This file provides:
 *   - A pre-configured `fetch` wrapper that reads the base URL from env
 *   - Placeholder product catalogue (display-only until backend is live)
 */

import { env } from './env';
import type { Product } from '../types/orders';
import { getAccessToken } from './auth';

/* ---------- API Fetch helper ---------- */

/** Status code used when the server could not be reached at all. */
export const NETWORK_ERROR_STATUS = 0;

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Resolves a FastAPI path whether the configured base URL includes `/api` or not.
 */
export function resolveApiUrl(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  const apiPath = env.apiBaseUrl.endsWith('/api') && normalized.startsWith('/api/')
    ? normalized.slice(4)
    : normalized;
  return `${env.apiBaseUrl}${apiPath}`;
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  if (!env.apiBaseUrl) throw new ApiError(0, 'Online ordering is not connected yet. Please contact the store.');
  const url = resolveApiUrl(path);
  const isFormData = options.body instanceof FormData;

  const headers = new Headers(options.headers);
  if (!isFormData && options.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  headers.set('Accept', 'application/json');
  const token = await getAccessToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  let res: Response;
  try {
    res = await fetch(url, { ...options, headers, signal: options.signal ?? AbortSignal.timeout(15_000) });
  } catch {
    throw new ApiError(
      NETWORK_ERROR_STATUS,
      'Cannot reach the Balaji Faki Point server. Please check your connection and try again.',
    );
  }

  if (!res.ok) {
    const body: unknown = await res.json().catch(() => ({}));
    throw new ApiError(res.status, extractDetail(body) ?? res.statusText);
  }

  if (res.status === 204) return undefined as T;
  try {
    return (await res.json()) as T;
  } catch {
    throw new ApiError(res.status, 'The server returned an unreadable response. Please try again.');
  }
}

/** FastAPI returns `detail` as a string or as a list of validation errors. */
function extractDetail(body: unknown): string | undefined {
  if (!body || typeof body !== 'object' || !('detail' in body)) return undefined;
  const detail = (body as { detail: unknown }).detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((d) => (d && typeof d === 'object' && 'msg' in d ? String(d.msg) : ''))
      .filter(Boolean)
      .join(' · ');
  }
  return undefined;
}

/** True when the request failed because the backend is unreachable. */
export function isNetworkError(err: unknown): boolean {
  return err instanceof ApiError && err.status === NETWORK_ERROR_STATUS;
}

/** Human-readable message for any thrown value. */
export function getErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return 'Something went wrong. Please try again.';
}

/* ---------- Catalogue shell ---------- */
/* Names and each product's first photo (static files) only. Prices always come from the database through FastAPI; while
   they load, or if the server is unreachable, every price is `null` ("Awaiting price") instead of an invented number. */

export const PRODUCT_SHELL: Product[] = [
  {
    type: 'faki',
    imageUrl: '/images/products/balaji-faki-box.webp',
    name: 'Faki',
    nameGu: 'ફાકી',
    packSizes: ['250g', '500g', '1kg'],
    prices: { '250g': null, '500g': null, '1kg': null },
  },
  {
    type: 'supari',
    imageUrl: '/images/supari-reference.png',
    name: 'Supari',
    nameGu: 'સુપારી',
    packSizes: ['250g', '500g', '1kg'],
    prices: { '250g': null, '500g': null, '1kg': null },
  },
  {
    type: 'mitho-mavo',
    imageUrl: '/images/products/balaji-mitho-mavo-sachet.webp',
    name: 'Mitho Mavo',
    nameGu: 'મીઠો માવો',
    packSizes: ['250g', '500g', '1kg'],
    prices: { '250g': null, '500g': null, '1kg': null },
  },
  {
    type: 'water',
    imageUrl: '/images/products/balaji-water-bottle.webp',
    name: 'Water Bottle',
    nameGu: 'પાણીની બોટલ',
    packSizes: ['1l'],
    prices: { '1l': null },
  },
  {
    type: 'chuno',
    imageUrl: '/images/products/balaji-chuno-sachets.webp',
    name: 'Chuno',
    nameGu: 'ચુનો',
    packSizes: ['250g', '500g', '1kg'],
    prices: { '250g': null, '500g': null, '1kg': null },
  },
  {
    type: 'tamaku',
    imageUrl: '/images/products/balaji-tamaku-sachets.webp',
    name: 'Tamaku',
    nameGu: 'તમાકુ',
    packSizes: ['250g', '500g', '1kg'],
    prices: { '250g': null, '500g': null, '1kg': null },
  },
];

/** Format a number as Indian Rupees */
export function formatINR(amount: number | null): string {
  if (amount === null || !Number.isFinite(amount)) return 'Awaiting price';
  return `₹${amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

/** 250g -> "250 g", 1kg -> "1 kg", 500ml -> "500 ml", 1l -> "1 L" */
export function formatPackSize(size: string): string {
  const match = /^([0-9]+)(g|kg|ml|l)$/.exec(size);
  return match ? `${match[1]} ${match[2] === 'l' ? 'L' : match[2]}` : size;
}
