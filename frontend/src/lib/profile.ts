import { apiFetch } from './api';
import { setProfile, type Profile } from './auth';

export async function updateProfile(details: { fullName: string; phone: string }) {
  const profile = await apiFetch<Profile>('/api/me', { method: 'PATCH', body: JSON.stringify(details) });
  setProfile(profile);
  return profile;
}
