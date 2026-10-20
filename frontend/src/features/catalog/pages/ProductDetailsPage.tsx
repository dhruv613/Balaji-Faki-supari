import { Link, useParams } from 'react-router-dom';
import Notice from '../../../components/common/Notice';
import { useOrder, useOrderDispatch } from '../../../context/OrderContext';
import ProductDetailsView from '../components/ProductDetailsView';

/** Public product page (deep link). The same details open in a dialog from the home-page product cards. */
export default function ProductDetailsPage() {
  const { slug = '' } = useParams();
  const { products, catalogStatus, catalogError } = useOrder();
  const dispatch = useOrderDispatch();
  const product = products.find(item => item.type === slug);
  if (catalogError) {
    return <div className="wrapper"><Notice tone="error" title="Cannot load product and prices">
      {catalogError} <button type="button" className="btn btn--sm" onClick={() => dispatch({ type: 'RETRY_CATALOG' })}>Try again</button>
    </Notice><p><Link to="/">Back to Home</Link></p></div>;
  }
  if (!product && catalogStatus === 'Loading current prices…') return <div className="wrapper"><p role="status" className="text-secondary">Loading product…</p></div>;
  if (!product) return <div className="wrapper"><Notice tone="warning" title="Product unavailable">This product is currently unavailable.</Notice><p><Link to="/">Back to Home</Link></p></div>;

  return (
    <div className="wrapper product-details">
      <p className="text-small"><Link to="/">Home</Link> / {product.name}</p>
      <ProductDetailsView product={product} />
    </div>
  );
}
