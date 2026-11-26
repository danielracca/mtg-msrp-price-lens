import type { ProductDatabase, ProductRecord } from './types';
import type { EffectiveRate } from './fx';
import type { Thresholds } from './settings';

export type Tier = 'great' | 'good' | 'neutral' | 'high' | 'very_high';

export type Basis =
  | 'official_cad' // Wizards published a CAD MSRP
  | 'official_usd_converted' // official USD MSRP × exchange rate → "Estimated CAD MSRP"
  | 'derived_benchmark'; // combined pack/unit MSRP — estimated benchmark, never official

export interface MsrpReference {
  basis: Basis;
  /** USD reference value (official or derived). */
  usd: number | null;
  /** Official CAD MSRP when published. */
  officialCad: number | null;
  /** Human description of how a derived value was computed. */
  derivationLabel: string | null;
  baseProduct: ProductRecord;
}

/**
 * Resolves the MSRP reference for a product and quantity.
 * - quantity > 1 multiplies an official unit MSRP into a derived benchmark.
 * - booster boxes resolve through their derivation (packCount × pack MSRP).
 * - listingPackCount lets a box whose pack count is unknown in the DB use the count stated by the retailer.
 * Returns null when no MSRP or benchmark exists.
 */
export function resolveReference(
  product: ProductRecord,
  db: ProductDatabase,
  quantity = 1,
  listingPackCount: number | null = null,
): MsrpReference | null {
  const m = product.msrp;
  if (m.classification === 'official') {
    if (quantity <= 1) {
      return { basis: m.cad != null ? 'official_cad' : 'official_usd_converted', usd: m.usd, officialCad: m.cad, derivationLabel: null, baseProduct: product };
    }
    return {
      basis: 'derived_benchmark',
      usd: m.usd != null ? round2(m.usd * quantity) : null,
      officialCad: m.cad != null ? round2(m.cad * quantity) : null,
      derivationLabel: `Combined MSRP — ${quantity} × ${product.name} (estimated benchmark)`,
      baseProduct: product,
    };
  }
  if (m.classification === 'derived' && m.derivation) {
    const base = db.products.find((p) => p.id === m.derivation!.fromProductId);
    if (!base || base.msrp.classification !== 'official' || base.msrp.usd == null) return null;
    const packs = m.derivation.quantity * Math.max(1, quantity);
    return {
      basis: 'derived_benchmark',
      usd: round2(base.msrp.usd * packs),
      officialCad: base.msrp.cad != null ? round2(base.msrp.cad * packs) : null,
      derivationLabel: `Combined pack MSRP — ${packs} × ${base.name} (estimated benchmark)`,
      baseProduct: base,
    };
  }
  if (m.classification === 'unavailable' && listingPackCount && listingPackCount > 1 && product.category.endsWith('_box')) {
    const packCat = product.category.replace('_box', '_pack');
    const base = db.products.find((p) => p.setCode === product.setCode && p.category === packCat && p.variant === null);
    if (base?.msrp.classification === 'official' && base.msrp.usd != null) {
      const packs = listingPackCount * Math.max(1, quantity);
      return {
        basis: 'derived_benchmark',
        usd: round2(base.msrp.usd * packs),
        officialCad: null,
        derivationLabel: `Combined pack MSRP — ${packs} × ${base.name}, pack count from retailer listing (estimated benchmark)`,
        baseProduct: base,
      };
    }
  }
  return null;
}

export interface Comparison {
  reference: MsrpReference;
  /** CAD value compared against (official CAD or converted). */
  msrpCad: number;
  /** Retailer price in CAD. */
  priceCad: number;
  diffPct: number;
  diffAmountCad: number;
  tier: Tier;
  estimated: boolean;
  rateUsed: number | null;
}

/** Estimated CAD MSRP = Official USD MSRP × USD-to-CAD rate. */
export function convertUsdToCad(usd: number, rate: number): number {
  return round2(usd * rate);
}

/** Percentage difference = ((price − msrp) / msrp) × 100. Negative = below MSRP. */
export function percentDifference(price: number, msrp: number): number {
  if (!(msrp > 0)) throw new Error('MSRP must be positive');
  return ((price - msrp) / msrp) * 100;
}

export function classifyTier(diffPct: number, t: Thresholds): Tier {
  const d = Math.round(diffPct * 100) / 100;
  if (d <= -t.greatDeal) return 'great';
  if (d <= -t.neutralBand) return 'good';
  if (d < t.neutralBand) return 'neutral';
  if (d < t.highMarkup) return 'high';
  return 'very_high';
}

export function compare(
  reference: MsrpReference,
  price: { amount: number; currency: 'CAD' | 'USD' },
  fx: EffectiveRate | null,
  thresholds: Thresholds,
): Comparison | null {
  let msrpCad: number;
  let rateUsed: number | null = null;
  if (reference.officialCad != null) {
    msrpCad = reference.officialCad;
  } else {
    if (reference.usd == null || !fx) return null;
    msrpCad = convertUsdToCad(reference.usd, fx.rate);
    rateUsed = fx.rate;
  }
  let priceCad = price.amount;
  if (price.currency === 'USD') {
    if (!fx) return null;
    priceCad = convertUsdToCad(price.amount, fx.rate);
    rateUsed = fx.rate;
  }
  const diffPct = percentDifference(priceCad, msrpCad);
  return {
    reference,
    msrpCad,
    priceCad,
    diffPct,
    diffAmountCad: round2(priceCad - msrpCad),
    tier: classifyTier(diffPct, thresholds),
    estimated: reference.basis !== 'official_cad',
    rateUsed,
  };
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
