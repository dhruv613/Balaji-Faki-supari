/**
 * Catalog API — product list with server prices.
 */

import { readProducts } from '../../../lib/contracts';
import { apiFetch } from '../../../lib/api';
import type { Product } from '../../../types/orders';

/** GET /products — active products, pack sizes and display prices */
export async function fetchProducts(): Promise<Product[]> {
  return readProducts(await apiFetch<unknown>('/products', { cache: 'no-store' }));
}

/** GET /products/{slug} — one active product with images, facts, prices and rating */
export async function fetchProduct(slug: string): Promise<Product> {
  const [product] = readProducts([await apiFetch<unknown>(`/products/${encodeURIComponent(slug)}`, { cache: 'no-store' })]);
  return product;
}
