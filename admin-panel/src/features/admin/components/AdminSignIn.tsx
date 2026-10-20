import { useState, type FormEvent } from 'react';
import Notice from '../../../components/common/Notice';
import { signIn } from '../../../lib/auth';
import { getErrorMessage } from '../../../lib/api';

/** The Admin Panel's one fixed login: the email and password are checked by the store's server. */
export default function AdminSignIn() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!email.trim() || !password) {
      setError('Enter the admin email and password.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await signIn(email, password);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form noValidate onSubmit={submit}>
      {error && <Notice tone="error">{error}</Notice>}
      <label htmlFor="admin-email">Admin email</label>
      <input className="input" id="admin-email" type="email" autoComplete="username" maxLength={254}
        value={email} onChange={event => setEmail(event.target.value)} required disabled={busy} />
      <label htmlFor="admin-password">Password</label>
      <input className="input" id="admin-password" type={showPassword ? 'text' : 'password'} autoComplete="current-password"
        maxLength={200} value={password} onChange={event => setPassword(event.target.value)} required disabled={busy} />
      <div className="checkbox-row">
        <input type="checkbox" id="admin-show-password" checked={showPassword} onChange={event => setShowPassword(event.target.checked)} />
        <label htmlFor="admin-show-password" style={{ marginBottom: 0, fontWeight: 400 }}>Show password</label>
      </div>
      <button className="btn btn--primary btn--full" disabled={busy}>
        {busy ? 'Please wait…' : 'Sign in'}
      </button>
    </form>
  );
}
