import { Link } from 'react-router-dom';
import { RatingLine } from '../../../components/common/Stars';
import { useOrder } from '../../../context/OrderContext';
import { contactDetails, useStoreProfile } from '../../store/storeApi';
import { PackPrices, primaryImage } from '../components/ProductParts';

export default function HomePage() {
  const { products, catalogStatus } = useOrder();
  const { profile } = useStoreProfile();
  const contact = contactDetails(profile);
  return (
    <>
      {/* ---- Hero Section ---- */}
      <section className="wrapper" id="hero-section">
        <div className="hero">
          <div className="hero__content">
            <span className="badge">Order online · Pay by UPI QR</span>
            <h1>Order Faki &amp; Supari online.</h1>
            <p className="hero__subtitle">
              Pick your pack, pay with a UPI QR, and see every confirmed update in My Orders.
            </p>
            <div className="hero__actions">
              <Link to="/order?product=faki" className="btn btn--primary" id="hero-order-faki-btn">
                Order Faki
              </Link>
              <Link to="/order?product=supari" className="btn btn--dark" id="hero-order-supari-btn">
                Order Supari
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

      {/* ---- Products ---- */}
      <section className="section" id="choose-pack">
        <div className="wrapper">
          <h2>Our products</h2>
          <div className="product-cards" style={{ marginTop: 28 }}>
            {products.map((product) => {
              const image = primaryImage(product);
              return (
                <div className="product-card" key={product.type}>
                  {image && <img className="product-card__image" src={image.url} alt={image.alt} loading="lazy" decoding="async" />}
                  <div className="product-card__name">{product.name}</div>
                  <RatingLine average={product.averageRating} count={product.reviewCount} />
                  {product.description?.trim() && <p className="product-card__details">{product.description.trim()}</p>}
                  <PackPrices product={product} />
                  <Link to={`/order?product=${product.type}`} className="btn btn--dark btn--full" id={`order-${product.type}-btn`}>
                    Order {product.name}
                  </Link>
                  <Link to={`/products/${product.type}`} className="btn btn--full" style={{ marginTop: 8 }} id={`details-${product.type}-btn`}>
                    View details &amp; reviews
                  </Link>
                </div>
              );
            })}
          </div>
          {catalogStatus && <p className="catalog-status text-small text-secondary" role="status">{catalogStatus}</p>}
        </div>
      </section>

      {/* ---- How Ordering Works ---- */}
      <section className="section section--tinted" id="how-it-works">
        <div className="wrapper">
          <h2>How ordering works</h2>
          <div className="grid" style={{ marginTop: 28 }}>
            <StepCard num={1} title="Fill the order form" desc="Choose your product, pack size, quantity and delivery details." />
            <StepCard num={2} title="Pay with UPI QR" desc="Scan, pay the exact amount and enter your transaction ID." />
            <StepCard num={3} title="We verify & confirm" desc="Payment verification comes first; the shop confirms before packing and delivery updates begin." />
          </div>
        </div>
      </section>

      {/* ---- Our shop ---- */}
      <section className="section" id="home-shop" aria-labelledby="home-shop-heading">
        <div className="wrapper">
          <div className="card">
            <h2 id="home-shop-heading">{profile?.storeName ?? 'Balaji Faki Point'}</h2>
            {profile?.shopIntro && <p style={{ marginTop: 8, whiteSpace: 'pre-line' }}>{profile.shopIntro}</p>}
            {profile?.storeAddress && <p className="text-secondary" style={{ marginTop: 8 }}>{profile.storeAddress}</p>}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 16 }}>
              <Link to="/store" className="btn" id="home-visit-store-btn">Visit our shop</Link>
              <Link to="/help" className="btn" id="home-help-btn">Help &amp; FAQs</Link>
              {contact.telHref && <a href={contact.telHref} className="btn">Call {contact.phoneDisplay}</a>}
              {contact.whatsappHref && <a href={contact.whatsappHref} className="btn" target="_blank" rel="noopener noreferrer">WhatsApp</a>}
            </div>
          </div>
        </div>
      </section>

      {/* ---- Customer Reviews ---- */}
      <section className="section section--tinted" id="home-customer-reviews" aria-labelledby="home-reviews-heading">
        <div className="wrapper">
          <div className="card" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
            <div>
              <span className="badge">Verified-purchase feedback</span>
              <h2 id="home-reviews-heading" style={{ marginTop: 8 }}>Customer reviews</h2>
              <p className="text-secondary" style={{ marginTop: 6 }}>
                Read what customers say, or share your own review after delivery.
              </p>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              <Link to="/reviews" className="btn" id="home-view-all-reviews-btn">Read reviews</Link>
              <Link to="/my-orders" className="btn btn--primary" id="home-reviews-write-btn">Write a review</Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

function StepCard({ num, title, desc }: { num: number; title: string; desc: string }) {
  return (
    <div className="card step-card">
      <div className="step-card__number">{num}</div>
      <h3>{title}</h3>
      <p>{desc}</p>
    </div>
  );
}
