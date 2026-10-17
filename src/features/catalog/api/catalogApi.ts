/**
 * Catalog API — product list with server prices.
 */

import { readProducts } from '../../../lib/contracts';
import { apiFetch } from '../../../lib/api';
import type { Product } from '../../../types/orders';

/** GET /products — active products, pack sizes and display prices */
export async function fetchProducts(): Promise<Product[]> {
  return readProducts(await apiFetch<unknown>('/products'));
}
