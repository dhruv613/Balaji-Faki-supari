import { useState, type FormEvent } from 'react';
import { supabase } from '../../lib/supabase';
import Notice from './Notice';

export default function EmailSignIn() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [register, setRegister] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!supabase || busy) return;
    setError(''); setMessage(''); setBusy(true);
    const cleanEmail = email.trim().toLowerCase();
    const cleanPassword = password;
    try {
      const credentials = { email: cleanEmail, password: cleanPassword };
      if (register) {
        const { data, error: authError } = await supabase.auth.signUp(credentials);
        if (authError) {
          const msg = authError.message?.toLowerCase() || '';
          if (msg.includes('already registered') || msg.includes('already exists')) {
            throw new Error('An account with this email already exists. Please sign in with your password.');
          }
          throw authError;
        }
        setPassword('');
        if (!data?.session) {
          setRegister(false);
          setMessage('Check your email for a confirmation link, then sign in. If you already have an account, sign in with your password.');
        }
      } else {
        // Unified single Continue flow:
        // 1. First attempt password login for existing accounts
        const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword(credentials);
        if (!signInError && signInData?.session) {
          setPassword('');
          return;
        }

        const errorMsg = (signInError?.message || '').toLowerCase();
        const isInvalidCreds =
          errorMsg.includes('invalid login credentials') ||
          errorMsg.includes('invalid_grant') ||
          (signInError as any)?.status === 400;

        if (signInError && !isInvalidCreds) {
          // Network errors, rate limits, etc. — rethrow directly
          throw signInError;
        }

        // 2. Email was unrecognised or password check failed.
        // Attempt signup to see if this is a new customer.
        const { data: signUpData, error: signUpError } = await supabase.auth.signUp(credentials);
        if (signUpError) {
          const signUpMsg = signUpError.message?.toLowerCase() || '';
          if (
            signUpMsg.includes('already registered') ||
            signUpMsg.includes('already exists') ||
            (signUpError as any)?.status === 422
          ) {
            // The account ALREADY exists — meaning the password was wrong!
            // Reject login; do NOT register replacement account.
            throw new Error('Invalid login credentials. Please check your password and try again.');
          }
          throw signUpError;
        }

        // When confirm email is enabled or identities are empty, GoTrue flags existing account
        if (
          signUpData?.user &&
          Array.isArray((signUpData.user as any).identities) &&
          (signUpData.user as any).identities.length === 0
        ) {
          throw new Error('Invalid login credentials. Please check your password and try again.');
        }

        // With Confirm email disabled, GoTrue creates user, triggers public.user_profiles
        // creation, and returns session immediately.
        setPassword('');
        if (!signUpData?.session) {
          setMessage('Check your email for a confirmation link, then sign in. If you already have an account, sign in with your password.');
        }
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to sign in. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return <section className="card card--tinted auth-card" aria-labelledby="sign-in-heading">
    <h1 id="sign-in-heading">{register ? 'Create your account' : 'Welcome to Balaji'}</h1>
    <p className="text-secondary">
      {register
        ? 'Create an account with your email and password to order fresh Faki & Supari online.'
        : 'Enter your email and password to sign in or create your account automatically.'}
    </p>
    {!supabase && <Notice title="Sign-in is not connected">Email sign-in is not configured yet. Please contact the store for help.</Notice>}
    <form onSubmit={submit}>
      {error && <Notice tone="error">{error}</Notice>}
      {message && <Notice>{message}</Notice>}
      <label htmlFor="login-email">Email address</label>
      <input className="input" id="login-email" type="email" autoComplete="username" maxLength={254}
        value={email} onChange={event => setEmail(event.target.value)} required disabled={busy} />
      <label htmlFor="login-password">Password</label>
      <input className="input" id="login-password" type="password" autoComplete={register ? 'new-password' : 'current-password'}
        minLength={6} value={password} onChange={event => setPassword(event.target.value)} required disabled={busy}
        aria-describedby="password-hint" />
      <p className="text-small text-secondary" id="password-hint">
        Use at least 6 characters. Your account keeps your orders and payment verification secure.
      </p>
      <button className="btn btn--primary btn--full" disabled={!supabase || busy}>
        {busy ? 'Please wait…' : register ? 'Create account' : 'Continue'}
      </button>
      <button className="text-button" type="button" disabled={busy} onClick={() => {
        setRegister(!register); setPassword(''); setError(''); setMessage('');
      }}>{register ? 'Already have an account? Sign in' : 'New customer? Create an account'}</button>
    </form>
  </section>;
}
