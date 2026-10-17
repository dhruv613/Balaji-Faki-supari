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
    </>
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
