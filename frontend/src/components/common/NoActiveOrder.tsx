import { Link } from 'react-router-dom';

interface NoActiveOrderProps {
  title?: string;
  message?: string;
}

/**
 * Shown when a payment step has no order reference in this browser.
 */
export default function NoActiveOrder({
  title = 'Find your order',
  message = 'Open My Orders to continue an existing order, or start a new order if you have not placed one yet.',
}: NoActiveOrderProps) {
  return (
    <div className="card" style={{ maxWidth: 640, margin: '0 auto', textAlign: 'center', padding: '48px 32px' }}>
      <div className="circle-icon circle-icon--pending">
        <svg className="icon icon--lg" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="9" cy="21" r="1" />
          <circle cx="20" cy="21" r="1" />
          <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
        </svg>
      </div>
      <h1 style={{ marginBottom: 8 }}>{title}</h1>
      <p className="text-secondary" style={{ maxWidth: 440, margin: '0 auto 28px' }}>
        {message}
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'center' }}>
        <Link to="/my-orders" className="btn btn--primary" id="view-orders-btn">
          My Orders
        </Link>
        <Link to="/order" className="btn" id="start-order-btn">
          Start a new order
        </Link>
      </div>
    </div>
  );
}
