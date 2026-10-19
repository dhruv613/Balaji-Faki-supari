import { useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api';
import { env } from '../../lib/env';

export interface StorePhoto {
  id: string;
  url: string;
  caption: string;
}

export interface StoreProfile {
  storeName: string;
  storeNameGu?: string;
  tagline: string;
  storeAddress: string;
  openingHours: string;
  supportPhone: string;
  supportWhatsapp: string;
  supportEmail: string;
  shopIntro: string;
  productionInfo: string;
  providerManufacturer: string;
  packagingInfo: string;
  photos: StorePhoto[];
}

const stringFields = [
  'storeName', 'tagline', 'storeAddress', 'openingHours', 'supportPhone', 'supportWhatsapp', 'supportEmail',
] as const;
const optionalTextFields = ['shopIntro', 'productionInfo', 'providerManufacturer', 'packagingInfo'] as const;

/** Validates the public shop profile; empty optional content means "not supplied". */
export function readStoreProfile(value: unknown): StoreProfile {
  if (!value || typeof value !== 'object') throw new Error('The store details could not be read.');
  const raw = value as Record<string, unknown>;
  for (const key of stringFields) {
    if (typeof raw[key] !== 'string') throw new Error('The store details could not be read.');
  }
  const photos = raw.photos ?? [];
  if (
    !Array.isArray(photos) ||
    !photos.every((photo) => photo && typeof photo.id === 'string' && typeof photo.url === 'string' && typeof photo.caption === 'string')
  ) {
    throw new Error('The store photos could not be read.');
  }
  const profile = { ...raw, photos } as Record<string, unknown>;
  for (const key of optionalTextFields) profile[key] = typeof raw[key] === 'string' ? raw[key] : '';
  return profile as unknown as StoreProfile;
}

/** GET /store — customer-facing details only; payment configuration stays server-side. */
export async function getStoreProfile(): Promise<StoreProfile> {
  return readStoreProfile(await apiFetch<unknown>('/store'));
}

export interface ContactDetails {
  phoneDisplay: string;
  telHref: string;
  whatsappHref: string;
  email: string;
}

/** Contact links from the shop profile; before it loads, only the configured WhatsApp number is used. */
export function contactDetails(profile: StoreProfile | null): ContactDetails {
  const digits = (profile?.supportWhatsapp || env.supportWhatsApp || '').replace(/\D/g, '');
  const phoneDisplay = profile?.supportPhone || (digits ? `+${digits}` : '');
  const phoneDigits = phoneDisplay.replace(/[^\d+]/g, '');
  return {
    phoneDisplay,
    telHref: phoneDigits ? `tel:${phoneDigits}` : '',
    whatsappHref: digits ? `https://wa.me/${digits}` : '',
    email: profile?.supportEmail ?? '',
  };
}

let cached: Promise<StoreProfile> | null = null;

/** Shop profile shared by every page; fetched once per page load. */
export function useStoreProfile(): { profile: StoreProfile | null; error: string } {
  const [state, setState] = useState<{ profile: StoreProfile | null; error: string }>({ profile: null, error: '' });
  useEffect(() => {
    let active = true;
    cached ??= getStoreProfile();
    cached
      .then((profile) => { if (active) setState({ profile, error: '' }); })
      .catch((reason) => {
        cached = null; // allow a retry on the next mount
        if (active) setState({ profile: null, error: reason instanceof Error ? reason.message : 'Store details are unavailable.' });
      });
    return () => { active = false; };
  }, []);
  return state;
}
