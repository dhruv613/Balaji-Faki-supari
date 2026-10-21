import { useState, type FormEvent } from 'react';
import { authClient, refreshSession } from '../../lib/auth';
import { updateProfile } from '../../lib/profile';
import { normalizeIndianMobile, validateCustomerDetails } from '../../lib/customer';
import MobileNumberInput from './MobileNumberInput';
import Notice from './Notice';

type Mode = 'signin' | 'register';

export const MIN_PASSWORD_LENGTH = 8;

/** Explains sign-in errors without silently creating an account. */
export function describeAuthFailure(error: unknown, mode: Mode): { message: string; suggest?: Mode } {
  const raw = error as { message?: string; status?: number; code?: string } | null;
  const text = `${raw?.message ?? ''} ${raw?.code ?? ''}`.toLowerCase();
  if (text.includes('invalid origin') || text.includes('invalid_origin') || text.includes('origin_not_allowed')) {
    return { message: "Sign-in is unavailable at this website address. Please use the store's main website or contact the store." };
  }
  if (mode === 'signin') {
    if (text.includes('invalid login credentials') || text.includes('invalid_credentials') || text.includes('invalid_email_or_password')) {
      return { message: 'The email or password is incorrect. Check them and try again.', suggest: 'register' };
    }
    if (text.includes('email not confirmed') || text.includes('email_not_confirmed') || text.includes('email_not_verified')) {
      return { message: 'Verify your email using the code we sent, then sign in.' };
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
  return { message: typeof raw?.message === 'string' && raw.message ? raw.message : 'Unable to continue. Please try again.' };
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
  const [verifying, setVerifying] = useState(false);
  const [code, setCode] = useState('');
  const [resetStep, setResetStep] = useState<'email' | 'code' | null>(null);
  const registering = mode === 'register';

  function switchMode(next: Mode) {
    setMode(next);
    setPassword('');
    setConfirmEmail('');
    setError('');
    setMessage('');
    setSuggest(null);
    setSubmitted(false);
    setVerifying(false);
    setCode('');
    setResetStep(null);
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
    if (!authClient || busy) return;
    setError(''); setMessage(''); setSuggest(null); setSubmitted(true);
    if (registering && Object.keys(fieldErrors).length) return;
    setBusy(true);
    try {
      if (registering) {
        const { error: authError } = await authClient.signUp.email({ email: cleanEmail, password, name: fullName.trim() });
        if (authError) throw authError;
        setVerifying(true);
        setMessage('Enter the verification code sent to your email. Existing orders reconnect only after your email is verified.');
      } else {
        // Sign in ONLY. A wrong password or mistyped email must never create an account.
        const { data, error: authError } = await authClient.signIn.email({ email: cleanEmail, password });
        if (authError) throw authError;
        if (!data?.user) throw new Error('Sign-in did not return a session. Please try again.');
        await refreshSession();
        setPassword('');
      }
    } catch (cause) {
      if ((cause as { code?: string })?.code === 'EMAIL_NOT_VERIFIED') setVerifying(true);
      const failure = describeAuthFailure(cause, mode);
      setError(failure.message);
      setSuggest(failure.suggest && !(signInOnly && failure.suggest === 'register') ? failure.suggest : null);
    } finally {
      setBusy(false);
    }
  }

  async function verify(event: FormEvent) {
    event.preventDefault();
    if (!authClient || busy) return;
    setBusy(true); setError('');
    try {
      const verified = await authClient.emailOtp.verifyEmail({ email: cleanEmail, otp: code.trim() });
      if (verified.error) throw verified.error;
      const signedIn = await authClient.signIn.email({ email: cleanEmail, password });
      if (signedIn.error) throw signedIn.error;
      await refreshSession();
      if (registering) await updateProfile({ fullName: fullName.trim(), phone: `+91${normalizeIndianMobile(phone)}` });
      setPassword(''); setCode(''); setVerifying(false);
    } catch (cause) {
      setError((cause as { message?: string })?.message || 'Unable to verify this code. Please try again.');
    } finally { setBusy(false); }
  }

  async function resendCode() {
    if (!authClient || busy) return;
    setBusy(true); setError('');
    try {
      const { error: sendError } = await authClient.emailOtp.sendVerificationOtp({ email: cleanEmail, type: 'email-verification' });
      if (sendError) throw sendError;
      setMessage('A new verification code has been sent.');
    } catch (cause) {
      setError((cause as { message?: string })?.message || 'Unable to send a code. Please try again.');
    } finally { setBusy(false); }
  }

  async function sendResetCode(event?: FormEvent) {
    event?.preventDefault();
    if (!authClient || busy) return;
    setError(''); setMessage('');
    if (!cleanEmail) { setError('Enter the email address of your account.'); return; }
    setBusy(true);
    try {
      const { error: sendError } = await authClient.emailOtp.sendVerificationOtp({ email: cleanEmail, type: 'forget-password' });
      if (sendError) throw sendError;
      setResetStep('code'); setCode(''); setPassword('');
      // Same message whether or not the account exists, so the form does not reveal who is registered.
      setMessage(`If ${cleanEmail} has an account, a reset code has been sent to it.`);
    } catch (cause) {
      setError(describeAuthFailure(cause, 'signin').message);
    } finally { setBusy(false); }
  }

  async function resetPassword(event: FormEvent) {
    event.preventDefault();
    if (!authClient || busy) return;
    setError(''); setMessage('');
    if (password.length < MIN_PASSWORD_LENGTH) { setError(`Use at least ${MIN_PASSWORD_LENGTH} characters for the new password.`); return; }
    setBusy(true);
    try {
      const reset = await authClient.emailOtp.resetPassword({ email: cleanEmail, otp: code.trim(), password });
      if (reset.error) throw reset.error;
      const signedIn = await authClient.signIn.email({ email: cleanEmail, password });
      if (signedIn.error) throw signedIn.error;
      await refreshSession();
      setPassword(''); setCode(''); setResetStep(null);
    } catch (cause) {
      setError((cause as { message?: string })?.message || 'Unable to reset the password. Check the code and try again.');
    } finally { setBusy(false); }
  }

  if (resetStep) return <section className="card card--tinted auth-card" aria-labelledby="reset-password-heading">
    <h1 id="reset-password-heading">Reset your password</h1>
    {error && <Notice tone="error">{error}</Notice>}
    {message && <Notice>{message}</Notice>}
    {resetStep === 'email' ? <form noValidate onSubmit={sendResetCode}>
      <label htmlFor="login-email">Email address</label>
      <input className="input" id="login-email" type="email" autoComplete="username" maxLength={254}
        value={email} onChange={event => setEmail(event.target.value)} required disabled={busy} />
      <button className="btn btn--primary btn--full" disabled={busy}>{busy ? 'Please wait…' : 'Send reset code'}</button>
    </form> : <form noValidate onSubmit={resetPassword}>
      <label htmlFor="reset-code">Reset code</label>
      <input className="input" id="reset-code" autoComplete="one-time-code" inputMode="numeric"
        value={code} onChange={event => setCode(event.target.value)} required disabled={busy} />
      <label htmlFor="login-password">New password</label>
      <input className="input" id="login-password" type={showPassword ? 'text' : 'password'} autoComplete="new-password"
        value={password} onChange={event => setPassword(event.target.value)} required disabled={busy} />
      <div className="checkbox-row">
        <input type="checkbox" id="show-password" checked={showPassword} onChange={event => setShowPassword(event.target.checked)} />
        <label htmlFor="show-password" style={{ marginBottom: 0, fontWeight: 400 }}>Show password</label>
      </div>
      <button className="btn btn--primary btn--full" disabled={busy || !code.trim()}>{busy ? 'Please wait…' : 'Set new password and sign in'}</button>
      <button className="text-button" type="button" onClick={() => sendResetCode()} disabled={busy}>Send a new code</button>
    </form>}
    <button className="text-button" type="button" onClick={() => switchMode('signin')} disabled={busy}>Back to sign in</button>
  </section>;

  if (verifying) return <section className="card card--tinted auth-card" aria-labelledby="verify-email-heading">
    <h1 id="verify-email-heading">Verify your email</h1>
    <p>Enter the code sent to {cleanEmail}.</p>
    {error && <Notice tone="error">{error}</Notice>}
    {message && <Notice>{message}</Notice>}
    <form onSubmit={verify}>
      <label htmlFor="email-verification-code">Verification code</label>
      <input className="input" id="email-verification-code" autoComplete="one-time-code" inputMode="numeric"
        value={code} onChange={event => setCode(event.target.value)} required disabled={busy} />
      <button className="btn btn--primary btn--full" disabled={busy || !code.trim()}>{busy ? 'Verifying…' : 'Verify email and sign in'}</button>
    </form>
    <button className="text-button" type="button" onClick={resendCode} disabled={busy}>Send a new code</button>
    <button className="text-button" type="button" onClick={() => switchMode('signin')} disabled={busy}>Back to sign in</button>
  </section>;

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
        ? 'Create your account with a new password. Use your existing email to reconnect your previous orders after verification.'
        : signInOnly
          ? 'Sign in with the Owner Admin email and password.'
          : 'Sign in with your email and password to place orders and follow your deliveries.'}
    </p>
    {!authClient && <Notice title="Sign-in is not connected">Email sign-in is not configured yet. Please contact the store for help.</Notice>}
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
      <button className="btn btn--primary btn--full" disabled={!authClient || busy}>
        {busy ? 'Please wait…' : registering ? 'Create account' : 'Sign in'}
      </button>
      {!registering && authClient && <button type="button" className="text-button" disabled={busy}
        onClick={() => { setError(''); setMessage(''); setSuggest(null); setPassword(''); setResetStep('email'); }}>
        Forgot password?
      </button>}
    </form>
  </section>;
}
