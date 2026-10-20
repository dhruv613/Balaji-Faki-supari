import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import EmailSignIn from '../../../components/common/EmailSignIn';
import MobileNumberInput from '../../../components/common/MobileNumberInput';
import Notice from '../../../components/common/Notice';
import { normalizeIndianMobile, readCustomerDetails, validateCustomerDetails } from '../../../lib/customer';
import { useSession } from '../../../lib/auth';
import { updateProfile } from '../../../lib/profile';

/** Customer profile: name and mobile number. Role and other privileged fields can never be edited here. */
export default function AccountPage() {
  const { session, loading } = useSession();
  const saved = readCustomerDetails(session?.user);
  const [fullName, setFullName] = useState(saved.fullName);
  const [phone, setPhone] = useState(saved.phone);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  useEffect(() => { setFullName(saved.fullName); setPhone(saved.phone); }, [session?.user.id, saved.fullName, saved.phone]);

  if (loading) return <div className="wrapper"><p role="status">Checking your sign-in…</p></div>;
  if (!session) return <div className="wrapper"><EmailSignIn /></div>;

  const errors = submitted ? validateCustomerDetails({ fullName, phone }) : {};

  async function save(event: FormEvent) {
    event.preventDefault();
    setSubmitted(true); setError(''); setMessage('');
    if (Object.keys(validateCustomerDetails({ fullName, phone })).length || busy) return;
    setBusy(true);
    try {
      await updateProfile({ fullName: fullName.trim(), phone: `+91${normalizeIndianMobile(phone)}` });
      setMessage('Your details were saved.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save your details. Please try again.');
    } finally { setBusy(false); }
  }

  return (
    <div className="wrapper">
      <h1 className="page__header">My account</h1>
      <section className="card card--tinted auth-card" aria-labelledby="account-heading">
        <h2 id="account-heading">Your details</h2>
        <p className="text-small auth-email">Signed in as {session.user.email}</p>
        <form noValidate onSubmit={save}>
          {error && <Notice tone="error">{error}</Notice>}
          {message && <Notice>{message}</Notice>}
          <label htmlFor="account-name">Full name</label>
          <input className="input" id="account-name" autoComplete="name" maxLength={100} value={fullName} disabled={busy}
            onChange={event => setFullName(event.target.value)} aria-invalid={Boolean(errors.fullName)} />
          {errors.fullName && <p className="field-error">{errors.fullName}</p>}
          <label htmlFor="account-phone">Indian mobile number (+91)</label>
          <MobileNumberInput id="account-phone" value={phone} onChange={setPhone} disabled={busy} aria-invalid={Boolean(errors.phone)} />
          {errors.phone && <p className="field-error">{errors.phone}</p>}
          <button className="btn btn--primary btn--full" disabled={busy}>{busy ? 'Saving…' : 'Save details'}</button>
        </form>
        <p style={{ marginTop: 16 }}><Link to="/my-orders">View my orders</Link></p>
      </section>
    </div>
  );
}
