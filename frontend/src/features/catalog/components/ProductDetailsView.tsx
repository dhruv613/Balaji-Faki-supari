import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Stars, { RatingLine } from '../../../components/common/Stars';
import { useOrder, useOrderDispatch } from '../../../context/OrderContext';
import { formatPackSize, resolveApiUrl } from '../../../lib/api';
import type { PackSize, Product } from '../../../types/orders';
import { getPublishedReviews, type ReviewList } from '../../reviews/reviewsApi';
import { PackPrices, ProductFacts } from './ProductParts';
import ProductName from '../../../components/common/ProductName';

/**
 * Full product details (photos with front/back switcher, description, pack sizes and prices, owner-supplied facts, real
 * reviews) with the Order button. Shared by the product page and the dialog opened from a product card.
 */
export default function ProductDetailsView({ product, headingTag: Heading = 'h1', titleId }: {
  product: Product;
  headingTag?: 'h1' | 'h2';
  titleId?: string;
}) {
  const navigate = useNavigate();
  const dispatch = useOrderDispatch();
  const { product: draftProduct } = useOrder();
  const [selected, setSelected] = useState<PackSize | null>(null);
  const [imageIndex, setImageIndex] = useState(0);
  const [reviews, setReviews] = useState<ReviewList | null>(null);

  useEffect(() => {
    let active = true;
    setSelected(product.packSizes.find((size) => product.prices[size] !== null) ?? product.packSizes[0] ?? null);
    setImageIndex(0); setReviews(null);
    getPublishedReviews(product.type, 'newest')
      .then((list) => { if (active) setReviews(list); })
      .catch(() => { if (active) setReviews(null); });
    return () => { active = false; };
  }, [product.type]);

  const gallery = product.images?.length
    ? product.images
    : product.imageUrl ? [{ id: 'bundled', url: product.imageUrl, alt: product.name, position: 0 }] : [];
  const current = gallery[Math.min(imageIndex, Math.max(0, gallery.length - 1))];
  const price = selected ? product.prices[selected] : null;

  function orderNow() {
    if (!selected || price === null) return;
    if (draftProduct !== product.type) dispatch({ type: 'SET_PRODUCT', payload: product.type });
    dispatch({ type: 'SET_PACK_SIZE', payload: selected });
    navigate('/order');
  }

  return (
    <>
      <div className="two-col">
        <section className="two-col__main" aria-label="Product images">
          {current
            ? <img className="product-gallery__main" src={current.url} alt={current.alt} decoding="async" />
            : <div className="card card--tinted">No product photo has been added yet.</div>}
          {gallery.length > 1 && (
            <div className="product-gallery__thumbs" role="group" aria-label="Choose product photo">
              {gallery.map((image, index) => (
                <button key={image.id} type="button" className="btn btn--sm product-gallery__thumb" aria-pressed={index === imageIndex}
                  aria-label={`Show photo ${index + 1} of ${gallery.length}: ${image.alt}`} onClick={() => setImageIndex(index)}>
                  <img src={image.url} alt="" loading="lazy" decoding="async" />
                </button>
              ))}
            </div>
          )}
        </section>

        <aside className="two-col__side card card--tinted">
          <Heading id={titleId} style={{ marginBottom: 4 }}><ProductName name={product.name} nameGu={product.nameGu} /></Heading>
          {product.category && <p className="text-small text-secondary">{product.category}</p>}
          <RatingLine average={product.averageRating} count={product.reviewCount} />
          {product.description?.trim() && <p style={{ marginTop: 12, whiteSpace: 'pre-line' }}>{product.description.trim()}</p>}
          <h2 style={{ fontSize: 18, marginTop: 16 }}>Pack size &amp; price</h2>
          <PackPrices product={product} selected={selected ?? undefined} onSelect={setSelected} />
          <button type="button" className="btn btn--primary btn--full" disabled={!selected || price === null} onClick={orderNow} id="product-order-btn">
            {selected && price !== null ? `Order ${product.name} · ${formatPackSize(selected)}` : 'Not available to order yet'}
          </button>
        </aside>
      </div>

      <section className="card" style={{ marginTop: 24 }} aria-labelledby={`${product.type}-facts-heading`}>
        <h2 id={`${product.type}-facts-heading`}>About this product</h2>
        <ProductFacts information={product.information} />
        {!Object.values(product.information ?? {}).some((value) => String(value ?? '').trim()) && (
          <p className="text-secondary" style={{ marginTop: 8 }}>
            Ingredients, preparation and storage details will appear here once the shop publishes them. Ask the store if you need them sooner.
          </p>
        )}
      </section>

      <section className="card" style={{ marginTop: 24 }} aria-labelledby={`${product.type}-reviews-heading`}>
        <h2 id={`${product.type}-reviews-heading`}>Customer reviews</h2>
        {reviews && reviews.summary.count > 0 ? (
          <>
            <div className="rating-bars" style={{ margin: '12px 0' }}>
              {([5, 4, 3, 2, 1] as const).map((star) => {
                const count = reviews.summary.distribution[String(star) as '1'];
                return (
                  <div className="rating-bar" key={star}>
                    <span>{star} stars</span>
                    <div className="rating-bar__track"><div className="rating-bar__fill" style={{ width: `${(count / reviews.summary.count) * 100}%` }} /></div>
                    <span>{count}</span>
                  </div>
                );
              })}
            </div>
            {reviews.items.slice(0, 5).map((review) => (
              <article className="review-card" key={review.id} style={{ marginTop: 12 }}>
                <div className="review-meta"><Stars rating={review.rating} /><strong>{review.customerName}</strong>
                  <span className="text-small text-secondary">· {new Date(review.createdAt).toLocaleDateString('en-IN')}</span>
                  {review.verifiedPurchase && <span className="badge">Verified purchase</span>}</div>
                <p style={{ margin: '8px 0' }}>{review.reviewText}</p>
                {review.photoUrls.length > 0 && (
                  <div className="review-photo-grid">
                    {review.photoUrls.map((url, index) => <img key={url} src={resolveApiUrl(url)} alt={`Customer photo ${index + 1}`} loading="lazy" />)}
                  </div>
                )}
              </article>
            ))}
            <p style={{ marginTop: 12 }}><Link to={`/reviews?product=${product.type}`}>Read all reviews</Link></p>
          </>
        ) : (
          <p className="text-secondary" style={{ marginTop: 8 }}>No reviews yet. Reviews appear here after customers receive their orders.</p>
        )}
      </section>
    </>
  );
}
