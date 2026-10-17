import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  return (
    <div className="wrapper">
      <section className="not-found" aria-labelledby="not-found-title">
        <p className="not-found__code" aria-hidden="true">404</p>
        <h1 id="not-found-title" style={{ marginBottom: 8 }}>Page not found</h1>
        <p className="text-secondary" style={{ marginBottom: 28 }}>
          The page you're looking for doesn't exist or has moved.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'center' }}>
          <Link to="/" className="btn btn--primary" id="not-found-home-btn">Back to Home</Link>
          <Link to="/order" className="btn" id="not-found-order-btn">Order Now</Link>
        </div>
      </section>
    </div>
  );
}
