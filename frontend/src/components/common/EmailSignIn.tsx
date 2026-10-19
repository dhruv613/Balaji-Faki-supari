import { useState, type FormEvent } from 'react';
import { supabase } from '../../lib/supabase';
import { normalizeIndianMobile, validateCustomerDetails } from '../../lib/customer';
import MobileNumberInput from './MobileNumberInput';
import Notice from './Notice';

type Mode = 'signin' | 'register';

export const MIN_PASSWORD_LENGTH = 8;

/** Maps a Supabase Auth failure to what the customer should do next. Never creates an account. */
export function describeAuthFailure(error: unknown, mode: Mode): { message: string; suggest?: Mode } {
  const raw = error as { message?: string; status?: number; code?: string } | null;
  const text = `${raw?.message ?? ''} ${raw?.code ?? ''}`.toLowerCase();
  if (mode === 'signin') {
    if (text.includes('invalid login credentials') || text.includes('invalid_credentials')) {
      return { message: 'The email or password is incorrect. Check them and try again.', suggest: 'register' };
    }
    if (text.includes('email not confirmed') || text.includes('email_not_confirmed')) {
      return { message: 'Confirm your email address using the link we sent, then sign in.' };
    }
  } else {
    if (text.includes('already registered') || text.includes('already exists') || text.includes('user_already_exists')) {
      return { message: 'An account already exists for this email. Sign in with your password instead.', suggest: 'signin' };
    }
    if (text.includes('password') && (text.includes('weak') || text.includes('least') || text.includes('short'))) {
      return { message: 'Choose a stronger password (at least 8 characters).' };
    }
  }
  if (text.includes('rate limit') || raw?.status === 429) {
    return { message: 'Too many attempts. Please wait a minute and try again.' };
  }
  if (text.includes('failed to fetch') || text.includes('network')) {
    return { message: 'We could not reach the sign-in service. Check your connection and try again.' };
  }
  return { message: error instanceof Error && error.message ? error.message : 'Unable to continue. Please try again.' };
}

export interface EmailSignInProps {
  /** Hide account creation (used for the Owner Admin sign-in). */
  signInOnly?: boolean;
  initialMode?: Mode;
}

export default function EmailSignIn({ signInOnly = false, initialMode = 'signin' }: EmailSignInProps = {}) {
  const [mode, setMode] = useState<Mode>(signInOnly ? 'signin' : initialMode);
  const [email, setEmail] = useState('');
  const [confirmEmail, setConfirmEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const [suggest, setSuggest] = useState<Mode | null>(null);
  const [message, setMessage] = useState('');
  const registering = mode === 'register';

  function switchMode(next: Mode) {
    setMode(next);
    setPassword('');
    setConfirmEmail('');
    setError('');
    setMessage('');
    setSuggest(null);
    setSubmitted(false);
  }

  const cleanEmail = email.trim().toLowerCase();
  const details = validateCustomerDetails({ fullName, phone });
  const fieldErrors: Record<string, string> = {};
  if (registering) {
    if (details.fullName) fieldErrors.fullName = details.fullName;
    if (details.phone) fieldErrors.phone = details.phone;
    if (confirmEmail.trim().toLowerCase() !== cleanEmail) fieldErrors.confirmEmail = 'The two email addresses do not match.';
    if (password.length < MIN_PASSWORD_LENGTH) fieldErrors.password = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  const shown = submitted ? fieldErrors : {};

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!supabase || busy) return;
    setError(''); setMessage(''); setSuggest(null); setSubmitted(true);
    if (registering && Object.keys(fieldErrors).length) return;
    setBusy(true);
    try {
      if (registering) {
        const { data, error: authError } = await supabase.auth.signUp(
          { email: cleanEmail, password },
          { fullName: fullName.trim(), phone: `+91${normalizeIndianMobile(phone)}` },
        );
        if (authError) throw authError;
        // Confirmation is off in local development, so a session starts immediately.
        // If a deployment enables it, the customer is told to confirm first.
        if (!data?.session) {
          setMessage('Check your email for a confirmation link, then sign in.');
          setMode('signin');
        }
      } else {
        // Sign in ONLY. A wrong password or mistyped email must never create an account.
        const { data, error: authError } = await supabase.auth.signInWithPassword({ email: cleanEmail, password });
        if (authError) throw authError;
        if (!data?.session) throw new Error('Sign-in did not return a session. Please try again.');
      }
      setPassword('');
    } catch (cause) {
      const failure = describeAuthFailure(cause, mode);
      setError(failure.message);
      setSuggest(failure.suggest && !(signInOnly && failure.suggest === 'register') ? failure.suggest : null);
    } finally {
      setBusy(false);
    }
  }

  return <section className="card card--tinted auth-card" aria-labelledby="sign-in-heading">
    <h1 id="sign-in-heading">{registering ? 'Create your account' : 'Sign in to Balaji'}</h1>
    {!signInOnly && <div className="auth-tabs" role="tablist" aria-label="Account options">
      <button type="button" role="tab" aria-selected={!registering} className={`auth-tab${!registering ? ' auth-tab--active' : ''}`}
        disabled={busy} onClick={() => switchMode('signin')}>Sign in</button>
      <button type="button" role="tab" aria-selected={registering} className={`auth-tab${registering ? ' auth-tab--active' : ''}`}
        disabled={busy} onClick={() => switchMode('register')}>Create account</button>
    </div>}
    <p className="text-secondary">
      {registering
        ? 'Create an account to place orders and follow them in My Orders.'
        : signInOnly
          ? 'Sign in with the Owner Admin email and password.'
          : 'Sign in with your email and password to place orders and follow your deliveries.'}
    </p>
    {!supabase && <Notice title="Sign-in is not connected">Email sign-in is not configured yet. Please contact the store for help.</Notice>}
    <form noValidate onSubmit={submit}>
      {error && <Notice tone="error">{error}{suggest && <>
        {' '}<button type="button" className="text-button" onClick={() => { const keepEmail = email; switchMode(suggest); setEmail(keepEmail); }}>
          {suggest === 'register' ? 'Create an account with this email' : 'Go to sign in'}
        </button>
      </>}</Notice>}
      {message && <Notice>{message}</Notice>}
      {registering && <>
        <label htmlFor="register-name">Full name</label>
        <input className="input" id="register-name" autoComplete="name" maxLength={100} value={fullName} disabled={busy}
          onChange={event => setFullName(event.target.value)} aria-invalid={Boolean(shown.fullName)} />
        {shown.fullName && <p className="field-error">{shown.fullName}</p>}
        <label htmlFor="register-phone">Indian mobile number (+91)</label>
        <MobileNumberInput id="register-phone" value={phone} onChange={setPhone} disabled={busy} aria-invalid={Boolean(shown.phone)} />
        {shown.phone && <p className="field-error">{shown.phone}</p>}
      </>}
      <label htmlFor="login-email">Email address</label>
      <input className="input" id="login-email" type="email" autoComplete="username" maxLength={254}
        value={email} onChange={event => setEmail(event.target.value)} required disabled={busy} />
      {registering && <>
        <label htmlFor="register-email-confirm">Confirm email address</label>
        <input className="input" id="register-email-confirm" type="email" autoComplete="off" maxLength={254}
          value={confirmEmail} onChange={event => setConfirmEmail(event.target.value)} disabled={busy}
          onPaste={event => event.preventDefault()} aria-invalid={Boolean(shown.confirmEmail)} />
        {shown.confirmEmail && <p className="field-error">{shown.confirmEmail}</p>}
      </>}
      <label htmlFor="login-password">Password</label>
      <input className="input" id="login-password" type={showPassword ? 'text' : 'password'}
        autoComplete={registering ? 'new-password' : 'current-password'}
        value={password} onChange={event => setPassword(event.target.value)} required disabled={busy}
        aria-invalid={Boolean(shown.password)} aria-describedby="password-hint" />
      {shown.password && <p className="field-error">{shown.password}</p>}
      <div className="checkbox-row">
        <input type="checkbox" id="show-password" checked={showPassword} onChange={event => setShowPassword(event.target.checked)} />
        <label htmlFor="show-password" style={{ marginBottom: 0, fontWeight: 400 }}>Show password</label>
      </div>
      {registering && <p className="text-small text-secondary" id="password-hint">
        Use at least {MIN_PASSWORD_LENGTH} characters. Your account keeps your orders and payment checks private.
      </p>}
      <button className="btn btn--primary btn--full" disabled={!supabase || busy}>
        {busy ? 'Please wait…' : registering ? 'Create account' : 'Sign in'}
      </button>
    </form>
  </section>;
}
