/**
 * Shared API utilities and placeholder product data.
 *
 * All real API calls will go through FastAPI. This file provides:
 *   - A pre-configured `fetch` wrapper that reads the base URL from env
 *   - Placeholder product catalogue (display-only until backend is live)
 */

import { env } from './env';
import type { Product } from '../types/orders';
import { supabase } from './supabase';

/* ---------- API Fetch helper ---------- */

/** Status code used when the server could not be reached at all. */
export const NETWORK_ERROR_STATUS = 0;

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  if (!env.apiBaseUrl) throw new ApiError(0, 'Online ordering is not connected yet. Please contact the store.');
  const url = `${env.apiBaseUrl}${path}`;
  const isFormData = options.body instanceof FormData;

  const headers = new Headers(options.headers);
  if (!isFormData && options.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  headers.set('Accept', 'application/json');
  const session = supabase ? (await supabase.auth.getSession()).data.session : null;
  if (session) headers.set('Authorization', `Bearer ${session.access_token}`);

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

/* ---------- Placeholder product catalogue ---------- */
/* Temporary local preview prices. FastAPI remains the source of truth when connected. */

export const PRODUCTS: Product[] = [
  {
    type: 'faki',
    name: 'Faki',
    nameGu: 'ફાકી',
    packSizes: ['250g', '500g', '1kg'],
    prices: {
      '250g': 250,
      '500g': 500,
      '1kg': 1000,
    },
  },
  {
    type: 'supari',
    name: 'Supari',
    nameGu: 'સુપારી',
    packSizes: ['250g', '500g', '1kg'],
    prices: {
      '250g': 200,
      '500g': 400,
      '1kg': 800,
    },
  },
];

/** Format a number as Indian Rupees */
export function formatINR(amount: number | null): string {
  if (amount === null || !Number.isFinite(amount)) return 'Awaiting price';
  return `₹${amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

export function formatPackSize(size: string): string {
  return size === '1kg' ? '1 kg' : size.replace('g', ' g');
}
