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
    try {
      const credentials = { email: email.trim(), password };
      const { data, error: authError } = register
        ? await supabase.auth.signUp(credentials)
        : await supabase.auth.signInWithPassword(credentials);
      if (authError) throw authError;
      setPassword('');
      if (register && !data.session) {
        setRegister(false);
        setMessage('Check your email for a confirmation link, then sign in. If you already have an account, sign in with your password.');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to sign in. Please try again.');
    } finally { setBusy(false); }
  }

  return <section className="card card--tinted auth-card" aria-labelledby="sign-in-heading">
    <h1 id="sign-in-heading">{register ? 'Create your account' : 'Welcome to Balaji'}</h1>
    <p className="text-secondary">
      {register
        ? 'Enter your email and password to create your account instantly (no email confirmation required).'
        : 'Enter your email and password — if your email is not in our database yet, an account will be created automatically.'}
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
        minLength={4} value={password} onChange={event => setPassword(event.target.value)} required disabled={busy}
        aria-describedby="password-hint" />
      <p className="text-small text-secondary" id="password-hint">
        Existing email in database → instant login ✅ · New email → creates account automatically ✅
      </p>
      <button className="btn btn--primary btn--full" disabled={!supabase || busy}>{busy ? 'Please wait…' : register ? 'Create account & login' : 'Continue (Sign in / Create account)'}</button>
      <button className="text-button" type="button" disabled={busy} onClick={() => {
        setRegister(!register); setPassword(''); setError(''); setMessage('');
      }}>{register ? 'Already have an account? Sign in' : 'New customer? Create an account'}</button>
    </form>
  </section>;
}
