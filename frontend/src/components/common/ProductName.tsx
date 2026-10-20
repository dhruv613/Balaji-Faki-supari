import type { Product, ProductType } from '../../types/orders';

/** "Faki (ફાકી)": the English product name with its Gujarati name beside it, when one is known. */
export default function ProductName({ name, nameGu }: { name: string; nameGu?: string | null }) {
  const gu = nameGu?.trim();
  return <>{name}{gu && <> <span lang="gu">({gu})</span></>}</>;
}

/** Gujarati name of a catalogue product by slug (orders carry only the slug and the English name). */
export function findNameGu(products: Product[], slug: ProductType): string {
  return products.find((p) => p.type === slug)?.nameGu ?? '';
}
