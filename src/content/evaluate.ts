import { categoryLabel } from '../core/ingest/buildDb';
import type { EffectiveRate } from '../core/fx';
import { type MatchResult, type MatcherIndex, matchListing } from '../core/matching/matcher';
import { normalizeTitle } from '../core/matching/normalize';
import { type Comparison, compare, resolveReference } from '../core/msrp';
import type { Settings } from '../core/settings';
import type { ProductRecord, RetailerListing } from '../core/types';

export const IGNORE_MAPPING = '__ignore__';

export type BadgeState =
  | 'compared' // official or estimated comparison available
  | 'benchmark_hidden' // only a derived benchmark exists and the user hides benchmarks
  | 'msrp_unavailable'
  | 'legacy'
  | 'uncertain'
  | 'no_price'
  | 'ignored';

/** Everything the badge, popover and popup need about one product on the page. */
export interface PageItem {
  key: string;
  retailer: string;
  title: string;
  url: string | null;
  priceCad: number | null;
  priceRaw: string | null;
  state: BadgeState;
  match: MatchResult;
  product: ProductRecord | null;
  comparison: Comparison | null;
  /** Shown to the user under "Why this match". */
  explanation: string[];
  manual: boolean;
}

export function mappingKey(listing: Pick<RetailerListing, 'retailer' | 'retailerProductId' | 'title'>): string {
  return `${listing.retailer}:${listing.retailerProductId ?? normalizeTitle(listing.title).trim()}`;
}

export function evaluateListing(
  key: string,
  listing: RetailerListing,
  index: MatcherIndex,
  fx: EffectiveRate | null,
  settings: Settings,
  manualMappings: Record<string, string>,
): PageItem {
  const manualId = manualMappings[mappingKey(listing)];
  let match: MatchResult;
  let manual = false;
  if (manualId === IGNORE_MAPPING) {
    match = { status: 'not_sealed', product: null, candidates: [], confidence: 1, method: 'manual', quantity: 1, listingPackCount: null, reasons: ['Marked as not a sealed MTG product by you'] };
    manual = true;
  } else if (manualId && index.db.products.some((p) => p.id === manualId)) {
    const product = index.db.products.find((p) => p.id === manualId)!;
    const auto = matchListing(listing, index);
    match = {
      ...auto,
      status: 'matched',
      product,
      confidence: 1,
      method: 'manual',
      // Keep detected quantity only if the automatic match agreed on the product.
      quantity: auto.product?.id === product.id ? auto.quantity : 1,
      reasons: ['Selected manually by you'],
    };
    manual = true;
  } else {
    match = matchListing(listing, index);
  }

  const base: Omit<PageItem, 'state' | 'comparison'> = {
    key,
    retailer: listing.retailer,
    title: listing.title,
    url: listing.url,
    priceCad: listing.price && listing.price.currency === 'CAD' ? listing.price.amount : listing.price && fx ? Math.round(listing.price.amount * fx.rate * 100) / 100 : null,
    priceRaw: listing.price?.raw ?? null,
    match,
    product: match.product,
    explanation: match.reasons,
    manual,
  };

  if (match.status === 'not_sealed') return { ...base, state: 'ignored', comparison: null };
  if (match.status === 'legacy') return { ...base, state: 'legacy', comparison: null };
  if (match.status === 'uncertain' || !match.product) return { ...base, state: 'uncertain', comparison: null };

  const reference = resolveReference(match.product, index.db, match.quantity, match.listingPackCount);
  if (!reference) return { ...base, state: 'msrp_unavailable', comparison: null };
  if (reference.basis === 'derived_benchmark' && !settings.showEstimatedBenchmarks) return { ...base, state: 'benchmark_hidden', comparison: null };
  if (!listing.price) return { ...base, state: 'no_price', comparison: null };

  const comparison = compare(reference, listing.price, fx, settings.thresholds);
  if (!comparison) return { ...base, state: 'no_price', comparison: null };
  return { ...base, state: 'compared', comparison };
}

export function productTypeLabel(p: ProductRecord): string {
  const ed = p.edition === 'collectors_edition' ? "Collector's Edition " : p.edition === 'premium_edition' ? 'Premium Edition ' : p.edition === 'game_edition' ? 'Game Edition ' : '';
  return `${ed}${categoryLabel(p.category)}${p.variant && p.category !== 'specialty_bundle' ? ` — ${p.variant}` : ''}`;
}

/** Whether a badge should be shown for this item under the current settings. */
export function isBadgeVisible(item: PageItem, settings: Settings): boolean {
  if (!settings.badgesEnabled || item.state === 'ignored') return false;
  if (settings.showOnlyBelowMsrp) {
    const c = item.comparison;
    // "Below MSRP" means outside the neutral band, and at least the configured minimum discount.
    return item.state === 'compared' && !!c && (c.tier === 'great' || c.tier === 'good') && c.diffPct <= -settings.minDiscountPct;
  }
  return true;
}
