import { useState, type FormEvent, type ReactNode } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase, useSession } from '../../lib/supabase';
import { normalizeIndianMobile, readCustomerDetails, validateCustomerDetails } from '../../lib/customer';
import EmailSignIn from './EmailSignIn';
import MobileNumberInput from './MobileNumberInput';
import Notice from './Notice';

function CompleteProfile({ user }: { user: User }) {
  const [details, setDetails] = useState(() => readCustomerDetails(user.user_metadata));
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const errors = submitted ? validateCustomerDetails(details) : {};

  async function save(event: FormEvent) {
    event.preventDefault(); setSubmitted(true); setError('');
    const invalid = validateCustomerDetails(details);
    if (invalid.fullName || invalid.phone) {
      document.getElementById(invalid.fullName ? 'profile-name' : 'profile-phone')?.focus();
      return;
    }
    if (!supabase || busy) return;
    setBusy(true);
    try {
      // Contact metadata is unverified and must never grant ownership or admin access.
      const { error: updateError } = await supabase.auth.updateUser({ data: {
        fullName: details.fullName.trim(), phone: `+91${normalizeIndianMobile(details.phone)}`,
      } });
      if (updateError) throw updateError;
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to save your details. Please try again.'); }
    finally { setBusy(false); }
  }

  async function signOut() {
    if (!supabase || busy) return;
    setBusy(true); setError('');
    try {
      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) throw signOutError;
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to sign out. Please try again.'); }
    finally { setBusy(false); }
  }

  return <section className="card card--tinted auth-card" aria-labelledby="profile-heading">
    <h1 id="profile-heading">Your details</h1>
    <p className="text-secondary">Add your name and mobile number before continuing to the store.</p>
    <p className="text-small auth-email">Signed in as {user.email}</p>
    <form noValidate onSubmit={save}>
      {error && <Notice tone="error">{error}</Notice>}
      <label htmlFor="profile-name">Full name</label>
      <input className="input" id="profile-name" autoComplete="name" maxLength={100} required value={details.fullName}
        onChange={event => setDetails({ ...details, fullName: event.target.value })} disabled={busy}
        aria-invalid={Boolean(errors.fullName)} aria-describedby={errors.fullName ? 'profile-name-error' : undefined} />
      {errors.fullName && <p className="field-error" id="profile-name-error">{errors.fullName}</p>}
      <label htmlFor="profile-phone">Indian mobile number (+91)</label>
      <MobileNumberInput id="profile-phone" value={details.phone} onChange={phone => setDetails({ ...details, phone })} required disabled={busy}
        aria-invalid={Boolean(errors.phone)} aria-describedby={errors.phone ? 'profile-phone-error' : 'phone-hint'} />
      {errors.phone && <p className="field-error" id="profile-phone-error">{errors.phone}</p>}
      <p className="text-small text-secondary" id="phone-hint">10 digits, starting with 6, 7, 8 or 9. Do not include +91.</p>
      <button className="btn btn--primary btn--full" disabled={busy}>{busy ? 'Please wait…' : 'Save details & continue'}</button>
      <button className="text-button" type="button" disabled={busy} onClick={signOut}>Use another account</button>
    </form>
  </section>;
}

export default function AuthGate({ children }: { children: (user: User) => ReactNode }) {
  const { session, loading } = useSession();
  if (!loading && session && !Object.keys(validateCustomerDetails(readCustomerDetails(session.user.user_metadata))).length) {
    return children(session.user);
  }
  return <main className="auth-page">
    <img className="auth-logo" src="/images/balaji-logo.png" width="140" height="72" alt="Balaji Faki Point" />
    {loading ? <p role="status">Checking your sign-in…</p>
      : session ? <CompleteProfile key={session.user.id} user={session.user} /> : <EmailSignIn />}
    <a href="tel:+918000961030" className="text-small">Need help? Call +91 80009 61030</a>
  </main>;
}
