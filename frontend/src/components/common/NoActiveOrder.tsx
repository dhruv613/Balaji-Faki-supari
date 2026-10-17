import { Link } from 'react-router-dom';

interface NoActiveOrderProps {
  title?: string;
  message?: string;
}

/**
 * Shown when a payment step is opened without a server-created order
 * (direct URL visit, new tab, or the backend never created one).
 */
export default function NoActiveOrder({
  title = 'No active order',
  message = 'Payment opens only after our server has created your order. Start from the order form to continue.',
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
        <Link to="/order" className="btn btn--primary" id="start-order-btn">
          Go to order form
        </Link>
        <Link to="/my-orders" className="btn" id="view-orders-btn">
          My Orders
        </Link>
      </div>
    </div>
  );
}
