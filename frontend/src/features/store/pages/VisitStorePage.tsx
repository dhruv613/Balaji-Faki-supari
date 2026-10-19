import Notice from '../../../components/common/Notice';
import { contactDetails, useStoreProfile, type StoreProfile } from '../storeApi';

function StoreInformation({ profile }: { profile: StoreProfile }) {
  const contact = contactDetails(profile);
  const directionsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(profile.storeAddress)}`;
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
        {contact.phoneDisplay && (
          <div className="summary-row store-info-row">
            <svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z" /></svg>
            <span>{contact.phoneDisplay}</span>
          </div>
        )}
        {contact.email && <div className="summary-row store-info-row"><span>Email: <a href={`mailto:${contact.email}`}>{contact.email}</a></span></div>}
        <a href={directionsUrl} target="_blank" rel="noopener noreferrer" className="btn btn--primary btn--full" style={{ marginTop: 12 }}>Get directions</a>
        {contact.telHref && <a href={contact.telHref} className="btn btn--full" style={{ marginTop: 12 }}>Call store</a>}
        {contact.whatsappHref && <a href={contact.whatsappHref} className="btn btn--full" style={{ marginTop: 12 }} target="_blank" rel="noopener noreferrer">WhatsApp</a>}
      </aside>

      <div>
        {profile.photos.length > 0 ? (
          <div className="store-photos" aria-label="Photos of our shop" style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
            {profile.photos.map((photo) => (
              <figure key={photo.id} style={{ margin: 0 }}>
                <img src={photo.url} alt={photo.caption || `${profile.storeName} shop`} loading="lazy" style={{ width: '100%', height: 'auto', borderRadius: 12 }} />
                {photo.caption && <figcaption className="text-small text-secondary">{photo.caption}</figcaption>}
              </figure>
            ))}
          </div>
        ) : (
          <div className="map-placeholder" aria-label="Store location">
            <div>
              <svg className="icon icon--lg" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s7-6 7-11a7 7 0 10-14 0c0 5 7 11 7 11z" /><circle cx="12" cy="10" r="2.5" /></svg>
              <p><strong>Find us</strong></p>
              <p className="text-small text-secondary">Use Get directions to open the shop location in Google Maps.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const SHOP_SECTIONS: Array<[keyof StoreProfile, string]> = [
  ['productionInfo', 'How our products are prepared'],
  ['providerManufacturer', 'Provider / manufacturer'],
  ['packagingInfo', 'Packaging'],
];

export default function VisitStorePage() {
  const { profile, error } = useStoreProfile();
  const sections = profile
    ? SHOP_SECTIONS.map(([key, title]) => [title, String(profile[key] ?? '').trim()] as const).filter(([, text]) => text)
    : [];
  return (
    <div className="wrapper">
      <h1 className="page__header">Our shop</h1>
      <p className="page__subtitle">{profile?.tagline || 'Store details are loaded from Balaji Faki Point.'}</p>
      {error && <Notice tone="warning" title="Store details are unavailable">{error}</Notice>}
      {profile?.shopIntro && <section className="card" style={{ marginBottom: 24 }} aria-label="About the shop"><p style={{ whiteSpace: 'pre-line' }}>{profile.shopIntro}</p></section>}
      {profile && <StoreInformation profile={profile} />}
      {!profile && !error && <p className="text-secondary" role="status">Loading store details…</p>}
      {sections.map(([title, text]) => (
        <section className="card" style={{ marginTop: 24 }} key={title} aria-label={title}>
          <h2>{title}</h2>
          <p style={{ marginTop: 8, whiteSpace: 'pre-line' }}>{text}</p>
        </section>
      ))}
    </div>
  );
}
