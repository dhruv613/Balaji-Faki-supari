/** Typed amounts: weight products can be ordered in any amount from 100 g to 10 kg (steps of 50 g) at a per-kg price. */
export const TYPED_MIN_GRAMS = 100;
export const TYPED_MAX_GRAMS = 10_000;
export const TYPED_STEP_GRAMS = 50;

/** Grams of an amount such as `750g` or `2kg`; null for anything else (including ml/l). */
export function amountToGrams(packSize: string): number | null {
  const match = /^([0-9]+)(g|kg)$/.exec(packSize);
  return match ? Number(match[1]) * (match[2] === 'kg' ? 1000 : 1) : null;
}

/** The form the API stores: whole kilograms as `2kg`, everything else in grams (`750g`, `2500g`). */
export function canonicalAmount(grams: number): string {
  return grams % 1000 === 0 ? `${grams / 1000}kg` : `${grams}g`;
}

export function typedAmountError(packSize: string): string | null {
  const grams = amountToGrams(packSize);
  return grams === null || grams < TYPED_MIN_GRAMS || grams > TYPED_MAX_GRAMS || grams % TYPED_STEP_GRAMS
    ? 'Enter an amount from 100 g to 10 kg, in steps of 50 g.'
    : null;
}

/** Rupees for `grams` at `pricePerKg`, rounded half-up to a whole rupee: the same rule as the server. */
export function perKgPrice(pricePerKg: number, grams: number): number {
  return Math.floor((Math.round(pricePerKg * 100) * grams + 50_000) / 100_000);
}
