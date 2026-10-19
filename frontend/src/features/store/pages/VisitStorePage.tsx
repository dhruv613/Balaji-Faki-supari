import { useEffect, useState } from 'react';
import Notice from '../../../components/common/Notice';
import { getErrorMessage } from '../../../lib/api';
import { getStoreProfile, type StoreProfile } from '../storeApi';

function StoreInformation({ profile }: { profile: StoreProfile }) {
  const directionsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(profile.storeAddress)}`;
  const phoneHref = `tel:${profile.supportPhone.replace(/[^\d+]/g, '')}`;

  return (
    <div className="store-layout">
      <aside className="card card--tinted" aria-label="Store details">
        <h2>{profile.storeName}</h2>
        <div className="summary-row store-info-row">
          <svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s7-6 7-11a7 7 0 10-14 0c0 5 7 11 7 11z" /><circle cx="12" cy="10" r="2.5" /></svg>
          <span>{profile.storeAddress}</span>
        </div>
        <div className="summary-row store-info-row">
          <svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
          <span>{profile.openingHours}</span>
        </div>
        <div className="summary-row store-info-row">
          <svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z" /></svg>
          <span>{profile.supportPhone}</span>
        </div>
        {profile.supportEmail && <div className="summary-row store-info-row"><span>Email: <a href={`mailto:${profile.supportEmail}`}>{profile.supportEmail}</a></span></div>}
        <a href={directionsUrl} target="_blank" rel="noopener noreferrer" className="btn btn--primary btn--full" style={{ marginTop: 12 }}>Get directions</a>
        <a href={phoneHref} className="btn btn--full" style={{ marginTop: 12 }}>Call store</a>
      </aside>
      <div className="map-placeholder" aria-label="Store map placeholder">
        <div>
          <svg className="icon icon--lg" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s7-6 7-11a7 7 0 10-14 0c0 5 7 11 7 11z" /><circle cx="12" cy="10" r="2.5" /></svg>
          <p><strong>Map</strong></p>
          <p className="text-small text-secondary">Use Get directions to open the store location in Google Maps.</p>
        </div>
      </div>
    </div>
  );
}

export default function VisitStorePage() {
  const [profile, setProfile] = useState<StoreProfile | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    getStoreProfile()
      .then((value) => { if (active) setProfile(value); })
      .catch((reason) => { if (active) setError(getErrorMessage(reason)); });
    return () => { active = false; };
  }, []);

  return (
    <div className="wrapper">
      <h1 className="page__header">Our shop</h1>
      <p className="page__subtitle">{profile?.tagline || 'Store details are loaded from Balaji Faki Point.'}</p>
      {error && <Notice tone="warning" title="Store details are unavailable">{error}</Notice>}
      {profile && <StoreInformation profile={profile} />}
      {!profile && !error && <p className="text-secondary" role="status">Loading store details…</p>}
      <section className="card" style={{ marginTop: 24 }} aria-labelledby="shop-information-heading">
        <h2 id="shop-information-heading">Product and shop information</h2>
        <p className="text-secondary" style={{ marginTop: 8 }}>
          Product-specific preparation, packaging, provider, and storage details appear only after the shop confirms them in the product catalogue.
        </p>
      </section>
    </div>
  );
}
