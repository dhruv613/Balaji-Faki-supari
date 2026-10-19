import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Notice from '../../../components/common/Notice';
import { getErrorMessage } from '../../../lib/api';
import type { Product } from '../../../types/orders';
import { fetchProduct } from '../api/catalogApi';
import ProductDetailsView from '../components/ProductDetailsView';

/** Public product page (deep link). The same details open in a dialog from the home-page product cards. */
export default function ProductDetailsPage() {
  const { slug = '' } = useParams();
  const [product, setProduct] = useState<Product | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setProduct(null); setError('');
    fetchProduct(slug)
      .then((value) => { if (active) setProduct(value); })
      .catch((reason) => { if (active) setError(getErrorMessage(reason)); });
    return () => { active = false; };
  }, [slug]);

  if (error) {
    return <div className="wrapper"><Notice tone="warning" title="Product unavailable">{error}</Notice><p><Link to="/">Back to Home</Link></p></div>;
  }
  if (!product) return <div className="wrapper"><p role="status" className="text-secondary">Loading product…</p></div>;

  return (
    <div className="wrapper product-details">
      <p className="text-small"><Link to="/">Home</Link> / {product.name}</p>
      <ProductDetailsView product={product} />
    </div>
  );
}
