export default function VisitStorePage() {
  return (
    <div className="wrapper">
      <h1 className="page__header">Our shop</h1>
      <p className="page__subtitle">Drop by and pick up your Faki &amp; Supari in person.</p>
      <div className="store-layout">
        <aside className="card card--tinted" aria-label="Store details">
          <h2>Balaji Faki Point</h2>
          <div className="summary-row store-info-row">
            <svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s7-6 7-11a7 7 0 10-14 0c0 5 7 11 7 11z" /><circle cx="12" cy="10" r="2.5" /></svg>
            <span>Riddhi Siddhi Complex, University Rd., nr. Bhagat Singh Garden, Rajkot, Gujarat 360005</span>
          </div>
          <div className="summary-row store-info-row">
            <svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
            <span>Call to confirm opening hours</span>
          </div>
          <div className="summary-row store-info-row">
            <svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z" /></svg>
            <span>+91 80009 61030</span>
          </div>
          <a href="https://www.google.com/maps/search/?api=1&query=Balaji+Faki+Point+Riddhi+Siddhi+Complex+University+Road+Rajkot+360005" target="_blank" rel="noopener noreferrer" className="btn btn--primary btn--full" style={{ marginTop: 12 }}>Get directions</a>
          <a href="tel:+918000961030" className="btn btn--full" style={{ marginTop: 12 }}>Call store</a>
        </aside>
        <div className="map-placeholder" aria-label="Store map placeholder">
          <div>
            <svg className="icon icon--lg" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s7-6 7-11a7 7 0 10-14 0c0 5 7 11 7 11z" /><circle cx="12" cy="10" r="2.5" /></svg>
            <p><strong>Map</strong></p>
            <p className="text-small text-secondary">Use Get directions to open the store location in Google Maps.</p>
          </div>
        </div>
      </div>
      <section className="card" style={{ marginTop: 24 }} aria-labelledby="shop-information-heading">
        <h2 id="shop-information-heading">Product and shop information</h2>
        <p className="text-secondary" style={{ marginTop: 8 }}>
          Call the store for current, store-confirmed preparation, packaging, provider, and storage information before ordering.
        </p>
      </section>
    </div>
  );
}
