import { formatINR, formatPackSize } from '../../../lib/api';
import type { PackSize, Product, ProductInformation } from '../../../types/orders';

/** First database image, falling back to the bundled catalogue image. */
export function primaryImage(product: Product): { url: string; alt: string } | null {
  const first = product.images?.[0];
  if (first) return { url: first.url, alt: first.alt || product.name };
  return product.imageUrl ? { url: product.imageUrl, alt: product.name } : null;
}

/** Pack sizes with database prices. Unapproved development prices are labelled; nothing is invented. */
export function PackPrices({ product, selected, onSelect }: {
  product: Product;
  selected?: PackSize;
  onSelect?: (size: PackSize) => void;
}) {
  return (
    <ul className="pack-prices" aria-label={`${product.name} pack sizes and prices`} style={{ listStyle: 'none', padding: 0, margin: '12px 0' }}>
      {product.packSizes.map((size) => {
        const price = product.prices[size];
        const unavailable = price === null || product.inStock?.[size] === false;
        const development = price !== null && product.priceConfirmed?.[size] === false;
        const content = (
          <>
            <span>{formatPackSize(size)}</span>
            <span>
              <strong>{price === null ? 'Awaiting price' : formatINR(price)}</strong>
              {price !== null && product.inStock?.[size] === false && <span className="text-small text-secondary" style={{ marginLeft: 8 }}>Out of stock</span>}
              {development && <span className="badge badge--dev" title="Development price - not yet approved by the owner" style={{ marginLeft: 8 }}>Development price</span>}
            </span>
          </>
        );
        return (
          <li key={size} className="summary-row">
            {onSelect ? (
              <button type="button" className={`btn btn--sm${selected === size ? ' btn--primary' : ''}`} disabled={unavailable}
                aria-pressed={selected === size} onClick={() => onSelect(size)}
                style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>{content}</button>
            ) : <span style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>{content}</span>}
          </li>
        );
      })}
    </ul>
  );
}

const FACT_LABELS: Array<[keyof ProductInformation, string]> = [
  ['ingredients', 'Ingredients'],
  ['popularity', 'What makes it popular'],
  ['characteristics', 'Characteristics'],
  ['productionPackaging', 'Preparation / production'],
  ['providerManufacturer', 'Manufacturer / provider'],
  ['packaging', 'Packaging'],
  ['safetyStorage', 'Storage'],
  ['shelfLife', 'Shelf life'],
  ['safetyDisclosures', 'Safety information'],
];

/** Only owner-supplied facts are rendered; missing facts are simply absent. */
export function ProductFacts({ information }: { information?: ProductInformation }) {
  const rows = information
    ? FACT_LABELS.map(([key, label]) => [label, (information[key] ?? '').trim()] as const).filter(([, value]) => value)
    : [];
  if (!rows.length) return null;
  return (
    <dl className="product-facts">
      {rows.map(([label, value]) => (
        <div key={label} style={{ marginTop: 12 }}>
          <dt><strong>{label}</strong></dt>
          <dd style={{ margin: '4px 0 0', whiteSpace: 'pre-line' }}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
