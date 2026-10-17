import { Link } from 'react-router-dom';
import { formatINR, formatPackSize } from '../../../lib/api';
import { useOrder } from '../../../context/OrderContext';

export default function HomePage() {
  const { products, catalogStatus } = useOrder();
  return (
    <>
      {/* ---- Hero Section ---- */}
      <section className="wrapper" id="hero-section">
        <div className="hero">
          <div className="hero__content">
            <span className="badge">Order online · Pay by UPI QR</span>
            <h1>
              Faki &amp; Supari,
              <br />
              ordered in two
              <br />
              minutes.
            </h1>
            <p className="hero__subtitle">
              Pick your pack, pay with a UPI QR and track your order —
              all in one place.
            </p>
            <div className="hero__actions">
              <Link to="/order" className="btn btn--primary" id="hero-order-btn">
                Order Now
              </Link>
              <Link to="/store" className="btn" id="hero-store-btn">
                Visit Store
              </Link>
            </div>
          </div>

          <div className="hero__photo">
            <img
              src="/images/supari-reference.png"
              alt="Bowl of sliced supari"
              width="700"
              height="621"
              loading="eager"
            />
          </div>
        </div>
      </section>

      {/* ---- How Ordering Works ---- */}
      <section className="section section--tinted" id="how-it-works">
        <div className="wrapper">
          <h2>How ordering works</h2>
          <div className="grid" style={{ marginTop: 28 }}>
            <StepCard
              num={1}
              title="Fill the order form"
              desc="Choose Faki or Supari, quantity and delivery details."
            />
            <StepCard
              num={2}
              title="Pay with UPI QR"
              desc="Scan, pay the exact amount and enter your transaction ID."
            />
            <StepCard
              num={3}
              title="We verify & dispatch"
              desc="Once payment is verified, your order becomes active."
            />
          </div>
        </div>
      </section>

      {/* ---- Choose Your Pack ---- */}
      <section className="section" id="choose-pack">
        <div className="wrapper">
          <h2>Choose your pack</h2>
          <div className="product-cards" style={{ marginTop: 28 }}>
            {products.map((product) => (
              <div className="product-card" key={product.type}>
                <div className="product-card__name">{product.name}</div>
                <p className="product-card__packs">
                  Packs: {product.packSizes.map(formatPackSize).join(' · ')}
                </p>
                <div className="product-card__price-row">
                  <span className="text-secondary">From</span>
                  <span className="product-card__price">
                    {formatINR(product.prices[product.packSizes[0]])} / {formatPackSize(product.packSizes[0])}
                  </span>
                </div>
                <Link
                  to={`/order?product=${product.type}`}
                  className="btn btn--dark btn--full"
                  id={`order-${product.type}-btn`}
                >
                  Order {product.name}
                </Link>
              </div>
            ))}
          </div>
          {catalogStatus && <p className="catalog-status text-small text-secondary" role="status">{catalogStatus}</p>}
        </div>
      </section>

      {/* ---- Customer Reviews Showcase Section ---- */}
      <section className="section section--tinted" id="home-customer-reviews" aria-labelledby="home-reviews-heading">
        <div className="wrapper">
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'flex-end',
              justifyContent: 'space-between',
              gap: 16,
              marginBottom: 28,
            }}
          >
            <div>
              <span className="badge">4.7 ★ Customer Rating · Rajkot</span>
              <h2 id="home-reviews-heading" style={{ marginTop: 8 }}>
                See here is our Customers Review — go &amp; checkout
              </h2>
              <p className="text-secondary" style={{ marginTop: 6 }}>
                Feedback from customers across Rajkot ordering Faki &amp; Supari online.
              </p>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              <Link to="/reviews" className="btn" id="home-view-all-reviews-btn">
                See All Reviews
              </Link>
              <Link to="/order" className="btn btn--primary" id="home-reviews-checkout-btn">
                Go &amp; Checkout
              </Link>
            </div>
          </div>

          <div className="reviews-grid" style={{ marginBottom: 28 }}>
            {HOME_FEATURED_REVIEWS.map((review) => (
              <article className="review-card" key={review.id} style={{ background: '#FFFFFF' }}>
                <div className="review-card__header">
                  <span className="review-avatar">{review.initials}</span>
                  <div>
                    <strong>{review.customerName}</strong>
                    <p className="review-location text-small text-secondary">
                      <svg className="icon icon--sm" viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M12 21s7-6 7-11a7 7 0 10-14 0c0 5 7 11 7 11z" />
                        <circle cx="12" cy="10" r="2.5" />
                      </svg>
                      {review.area}
                    </p>
                  </div>
                </div>

                <div className="review-meta">
                  <HomeStars rating={review.rating} />
                  <strong>{review.rating}.0</strong>
                  <span className="text-small text-secondary">· {review.createdAt}</span>
                </div>

                <p style={{ margin: '12px 0' }}>{review.feedback}</p>

                <div className="review-footer">
                  <span className="text-small text-secondary">
                    {review.product} · {review.packSize}
                  </span>
                  <Link
                    to={`/order?product=${review.productType}`}
                    className="text-small"
                    style={{
                      color: 'var(--color-primary-dark, #B93C06)',
                      fontWeight: 600,
                      textDecoration: 'none',
                    }}
                  >
                    Order &amp; Checkout →
                  </Link>
                </div>
              </article>
            ))}
          </div>

          <div
            className="card"
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 16,
              background: '#FFFFFF',
            }}
          >
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 16 }}>
              <div
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: 36,
                  lineHeight: 1,
                  color: 'var(--color-text)',
                }}
              >
                4.7
              </div>
              <div>
                <div className="review-meta" style={{ margin: 0 }}>
                  <HomeStars rating={5} />
                  <span className="text-small text-secondary">out of 5 · 6 reference customer reviews</span>
                </div>
                <p className="text-small text-secondary" style={{ margin: '4px 0 0' }}>
                  Loved by customers in Kalawad Road, University Road, Raiya Road &amp; Mavdi.
                </p>
              </div>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              <Link to="/reviews" className="btn">
                Read or Write a Review
              </Link>
              <Link to="/order" className="btn btn--primary">
                Order Now &amp; Checkout
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

/* ---------- Home Featured Reviews Data & Helpers ---------- */

const HOME_FEATURED_REVIEWS = [
  {
    id: 'home-rev-1',
    initials: 'HP',
    customerName: 'Hetal P.',
    area: 'Kalawad Road, Rajkot',
    rating: 5,
    feedback: 'Ordered online, paid by QR and got my confirmation quickly. Packing was neat.',
    product: 'Faki',
    productType: 'faki',
    packSize: '500 g',
    createdAt: '12 Oct 2026',
  },
  {
    id: 'home-rev-2',
    initials: 'RM',
    customerName: 'Rahul M.',
    area: 'University Road, Rajkot',
    rating: 5,
    feedback: 'Easy order form, and tracking showed every step until delivery.',
    product: 'Supari',
    productType: 'supari',
    packSize: '250 g',
    createdAt: '9 Oct 2026',
  },
  {
    id: 'home-rev-3',
    initials: 'JS',
    customerName: 'Jignesh S.',
    area: 'Raiya Road, Rajkot',
    rating: 4,
    feedback: 'Good quality. Payment verification took a little while, but the team called me.',
    product: 'Faki',
    productType: 'faki',
    packSize: '1 kg',
    createdAt: '3 Oct 2026',
  },
  {
    id: 'home-rev-4',
    initials: 'PD',
    customerName: 'Pooja D.',
    area: 'Mavdi, Rajkot',
    rating: 5,
    feedback: 'Reordering from My Orders was simple. Will order again.',
    product: 'Faki',
    productType: 'faki',
    packSize: '250 g',
    createdAt: '28 Sep 2026',
  },
] as const;

function HomeStars({ rating }: { rating: number }) {
  return (
    <span className="stars" role="img" aria-label={`${rating} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((star) => (
        <svg
          key={star}
          className="icon icon--sm"
          viewBox="0 0 24 24"
          aria-hidden="true"
          style={{ fill: star <= rating ? 'currentColor' : 'none' }}
        >
          <path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9 6.8 19.7l1-5.9L3.5 9.7l5.9-.8z" />
        </svg>
      ))}
    </span>
  );
}

/* ---------- Step Card ---------- */

function StepCard({ num, title, desc }: { num: number; title: string; desc: string }) {
  return (
    <div className="card step-card">
      <div className="step-card__number">{num}</div>
      <h3>{title}</h3>
      <p>{desc}</p>
    </div>
  );
}

