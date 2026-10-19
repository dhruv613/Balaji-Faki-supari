import { apiFetch } from '../../lib/api';

export interface StoreProfile {
  storeName: string;
  tagline: string;
  storeAddress: string;
  openingHours: string;
  supportPhone: string;
  supportWhatsapp: string;
  supportEmail: string;
}

/** GET /store — customer-facing details only; payment configuration stays server-side. */
export function getStoreProfile(): Promise<StoreProfile> {
  return apiFetch<StoreProfile>('/store');
}
