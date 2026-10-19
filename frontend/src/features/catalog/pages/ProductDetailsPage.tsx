import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import Notice from '../../../components/common/Notice';
import Stars, { RatingLine } from '../../../components/common/Stars';
import { useOrder, useOrderDispatch } from '../../../context/OrderContext';
import { formatPackSize, getErrorMessage, resolveApiUrl } from '../../../lib/api';
import type { PackSize, Product } from '../../../types/orders';
import { getPublishedReviews, type ReviewList } from '../../reviews/reviewsApi';
import { fetchProduct } from '../api/catalogApi';
import { PackPrices, ProductFacts } from '../components/ProductParts';

/** Public product page: database-driven images, prices, owner-supplied facts and real reviews. */
export default function ProductDetailsPage() {
  const { slug = '' } = useParams();
  const navigate = useNavigate();
  const dispatch = useOrderDispatch();
  const { product: draftProduct } = useOrder();
  const [product, setProduct] = useState<Product | null>(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<PackSize | null>(null);
  const [imageIndex, setImageIndex] = useState(0);
  const [reviews, setReviews] = useState<ReviewList | null>(null);

  useEffect(() => {
    let active = true;
    setProduct(null); setError(''); setImageIndex(0); setReviews(null);
    fetchProduct(slug)
      .then((value) => {
        if (!active) return;
        setProduct(value);
        setSelected(value.packSizes.find((size) => value.prices[size] !== null) ?? value.packSizes[0] ?? null);
      })
      .catch((reason) => { if (active) setError(getErrorMessage(reason)); });
    getPublishedReviews(slug === 'faki' || slug === 'supari' ? slug : undefined, 'newest')
      .then((list) => { if (active) setReviews(list); })
      .catch(() => { if (active) setReviews(null); });
    return () => { active = false; };
  }, [slug]);

  if (error) {
    return <div className="wrapper"><Notice tone="warning" title="Product unavailable">{error}</Notice><p><Link to="/">Back to Home</Link></p></div>;
  }
  if (!product) return <div className="wrapper"><p role="status" className="text-secondary">Loading product…</p></div>;

  const gallery = product.images?.length
    ? product.images
    : product.imageUrl ? [{ id: 'bundled', url: product.imageUrl, alt: product.name, position: 0 }] : [];
  const current = gallery[Math.min(imageIndex, Math.max(0, gallery.length - 1))];
  const price = selected ? product.prices[selected] : null;

  function orderNow() {
    if (!selected || price === null) return;
    if (draftProduct !== product!.type) dispatch({ type: 'SET_PRODUCT', payload: product!.type });
    dispatch({ type: 'SET_PACK_SIZE', payload: selected });
    navigate('/order');
  }

  return (
    <div className="wrapper product-details">
      <p className="text-small"><Link to="/">Home</Link> / {product.name}</p>
      <div className="two-col">
        <section className="two-col__main" aria-label="Product images">
          {current
            ? <img className="product-card__image" src={current.url} alt={current.alt} style={{ width: '100%', height: 'auto' }} />
            : <div className="card card--tinted">No product photo has been added yet.</div>}
          {gallery.length > 1 && (
            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }} role="group" aria-label="Choose product photo">
              {gallery.map((image, index) => (
                <button key={image.id} type="button" className="btn btn--sm" aria-pressed={index === imageIndex}
                  onClick={() => setImageIndex(index)} style={{ padding: 2 }}>
                  <img src={image.url} alt={image.alt} width="64" height="48" style={{ objectFit: 'cover' }} />
                </button>
              ))}
            </div>
          )}
        </section>

        <aside className="two-col__side card card--tinted">
          <h1 style={{ marginBottom: 4 }}>{product.name}</h1>
          {product.nameGu && <p className="text-secondary">{product.nameGu}</p>}
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

      <section className="card" style={{ marginTop: 24 }} aria-labelledby="product-facts-heading">
        <h2 id="product-facts-heading">About this product</h2>
        <ProductFacts information={product.information} />
        {!Object.values(product.information ?? {}).some((value) => String(value ?? '').trim()) && (
          <p className="text-secondary" style={{ marginTop: 8 }}>
            Ingredients, preparation and storage details will appear here once the shop publishes them. Ask the store if you need them sooner.
          </p>
        )}
      </section>

      <section className="card" style={{ marginTop: 24 }} aria-labelledby="product-reviews-heading">
        <h2 id="product-reviews-heading">Customer reviews</h2>
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
    </div>
  );
}
