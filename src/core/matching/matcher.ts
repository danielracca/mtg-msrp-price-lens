import type { ProductCategory, ProductDatabase, ProductRecord, RetailerListing, SetRecord } from '../types';
import { detectCategories, detectEdition, detectQuantity, exclusionReason, hasMtgSignal } from './detect';
import { containsPhrase, diceSimilarity, normalizeTitle } from './normalize';

export type MatchStatus =
  | 'matched' // confident, safe to show a comparison
  | 'uncertain' // looks like sealed MTG but identity is ambiguous → no comparison shown
  | 'legacy' // sealed product from a set without official MSRPs
  | 'not_sealed'; // not a sealed MTG product → ignored (no badge)

export interface MatchResult {
  status: MatchStatus;
  product: ProductRecord | null;
  /** Products the user can choose from when uncertain (best first). */
  candidates: ProductRecord[];
  confidence: number;
  method: 'upc' | 'manual' | 'rules' | 'none';
  quantity: number;
  listingPackCount: number | null;
  reasons: string[];
  legacySetName?: string;
}

export const CONFIDENCE_THRESHOLD = 0.75;

export interface MatcherIndex {
  db: ProductDatabase;
  byUpc: Map<string, ProductRecord>;
  setAliases: { set: SetRecord; phrase: string }[];
  variantAliases: { product: ProductRecord; phrase: string }[];
}

export function buildIndex(db: ProductDatabase): MatcherIndex {
  const byUpc = new Map<string, ProductRecord>();
  for (const p of db.products) for (const u of p.upc) byUpc.set(normalizeUpc(u), p);
  const setAliases = db.sets.flatMap((set) => [set.name, ...set.aliases].map((phrase) => ({ set, phrase })));
  // Longest phrases first so "Secrets of Strixhaven" wins over shorter overlaps.
  setAliases.sort((a, b) => b.phrase.length - a.phrase.length);
  // An alias shared by several products of one set (e.g. the source label "Foundations Commander Deck"
  // on five different decks) cannot identify a variant, so it is excluded.
  const aliasOwners = new Map<string, Set<string>>();
  const candidatesV = db.products
    .filter((p) => p.variant)
    .flatMap((p) => {
      // The raw source label ("Commander Deck", "Foundations Commander Deck") describes a type, not a variant.
      const label = p.msrp.sourceLabel?.split(':')[0]?.trim();
      return [p.variant!, ...p.aliases.filter((a) => a !== p.variant && a !== label)].map((phrase) => ({ product: p, phrase }));
    })
    .filter((v) => normalizeTitle(v.phrase).trim().length >= 4);
  for (const v of candidatesV) {
    const k = `${v.product.setCode}|${normalizeTitle(v.phrase)}`;
    if (!aliasOwners.has(k)) aliasOwners.set(k, new Set());
    aliasOwners.get(k)!.add(`${v.product.category}|${v.product.variant}`);
  }
  const variantAliases = candidatesV.filter((v) => aliasOwners.get(`${v.product.setCode}|${normalizeTitle(v.phrase)}`)!.size === 1);
  return { db, byUpc, setAliases, variantAliases };
}

export function normalizeUpc(u: string): string {
  const d = u.replace(/\D/g, '');
  // GTIN-13 with a leading 0 is the same product as the 12-digit UPC-A.
  return d.length === 13 && d.startsWith('0') ? d.slice(1) : d.length === 14 ? d.replace(/^0+/, '').padStart(12, '0') : d;
}

function result(partial: Partial<MatchResult> & Pick<MatchResult, 'status'>): MatchResult {
  return { product: null, candidates: [], confidence: 0, method: 'rules', quantity: 1, listingPackCount: null, reasons: [], ...partial };
}

export function matchListing(listing: Pick<RetailerListing, 'title' | 'upc' | 'description'>, index: MatcherIndex): MatchResult {
  const reasons: string[] = [];
  const n = normalizeTitle(listing.title);

  // 1. UPC / GTIN — deterministic and strongest.
  if (listing.upc) {
    const hit = index.byUpc.get(normalizeUpc(listing.upc));
    if (hit) {
      const q = detectQuantity(n, hit.category);
      return result({ status: 'matched', product: hit, confidence: 0.99, method: 'upc', quantity: q.units, listingPackCount: q.packCount, reasons: [`UPC ${listing.upc} matched`] });
    }
  }

  const categories = detectCategories(n);
  const mtg = hasMtgSignal(n);

  // 2. Is this a sealed MTG product at all?
  const excluded = exclusionReason(n, categories.length > 0);
  if (excluded) return result({ status: 'not_sealed', method: 'none', reasons: [`Ignored: ${excluded}`] });

  // 3. Set detection (sets with MSRPs, then legacy sets).
  const variantHits = index.variantAliases.filter((v) => containsPhrase(n, v.phrase));
  let setHits = uniqueSets(index.setAliases.filter((a) => containsPhrase(n, a.phrase)).map((a) => a.set));
  const legacyHit = index.db.legacySets.find((l) => [l.name, ...l.aliases].some((a) => containsPhrase(n, a)));

  // A named variant (e.g. "Reign of Dragons") pins the set, even if another set's name appears ("Foundations Commander Deck").
  const variantSets = uniqueSets(variantHits.map((v) => index.db.sets.find((s) => s.code === v.product.setCode)!).filter(Boolean));
  if (variantSets.length === 1 && setHits.length !== 1) setHits = variantSets;
  else if (variantSets.length === 1 && setHits.length === 1 && setHits[0].code !== variantSets[0].code) {
    // e.g. "Foundations" alias + Reality Fracture deck name: trust the specific variant.
    setHits = variantSets;
  }

  const universesBeyondOnly = setHits.length > 0 && setHits.every((s) => s.universesBeyond);
  if (!mtg && (setHits.length === 0 || universesBeyondOnly)) {
    // Licensed names (Star Trek, Spider-Man, Avatar…) need an explicit Magic signal.
    if (!(setHits.length && variantHits.length && categories.length)) {
      return result({ status: 'not_sealed', method: 'none', reasons: ['No Magic: The Gathering signal in title'] });
    }
  }
  if (categories.length === 0) {
    return result({ status: 'not_sealed', method: 'none', reasons: ['No sealed product type detected (likely a single card or accessory)'] });
  }

  if (setHits.length === 0) {
    if (legacyHit) {
      return result({ status: 'legacy', method: 'rules', confidence: 0.9, legacySetName: legacyHit.name, reasons: [`${legacyHit.name}: ${legacyHit.reason}`] });
    }
    return result({ status: 'uncertain', method: 'rules', confidence: 0.2, candidates: index.db.products.filter((p) => categories.includes(p.category)).slice(0, 50), reasons: ['Sealed MTG product, but the set could not be identified'] });
  }
  if (setHits.length > 1) {
    return result({
      status: 'uncertain',
      confidence: 0.3,
      candidates: index.db.products.filter((p) => setHits.some((s) => s.code === p.setCode) && categories.includes(p.category)),
      reasons: [`Multiple sets mentioned: ${setHits.map((s) => s.name).join(', ')}`],
    });
  }
  const set = setHits[0];
  if (legacyHit && !variantHits.length) reasons.push(`Also mentions ${legacyHit.name}`);
  reasons.push(`Set: ${set.name}`);

  // 4. Category + edition within the set.
  const edition = detectEdition(n);
  const inSet = index.db.products.filter((p) => p.setCode === set.code);
  let category: ProductCategory | null = null;
  let pool: ProductRecord[] = [];
  // A named specialty product (e.g. "Chocobo Bundle") decides the category among plausible ones.
  const hinted = variantHits.map((v) => v.product).filter((p) => p.setCode === set.code && categories.includes(p.category));
  const orderedCategories = [...new Set([...hinted.map((p) => p.category), ...categories])];
  for (const c of orderedCategories) {
    const byCat = inSet.filter((p) => p.category === c);
    if (byCat.length === 0) continue;
    const byEdition = byCat.filter((p) => p.edition === edition);
    category = c;
    pool = byEdition;
    if (byEdition.length === 0) reasons.push(`No ${edition.replace('_', ' ')} ${c.replace(/_/g, ' ')} in ${set.name}`);
    break;
  }
  if (!category || pool.length === 0) {
    return result({
      status: 'uncertain',
      confidence: 0.4,
      candidates: inSet,
      reasons: [...reasons, `Product type (${categories.map((c) => c.replace(/_/g, ' ')).join(' / ')}) not found for ${set.name}`],
    });
  }
  reasons.push(`Type: ${category.replace(/_/g, ' ')}${edition !== 'standard' ? ` (${edition.replace('_', ' ')})` : ''}`);

  // 5. Variant resolution.
  const variantInPool = pool.filter((p) => variantHits.some((v) => v.product.id === p.id));
  let product: ProductRecord | null = null;
  let confidence = 0.55; // set + category
  if (mtg) confidence += 0.1;
  if (variantInPool.length === 1) {
    product = variantInPool[0];
    confidence += 0.3;
    reasons.push(`Variant: ${product.variant}`);
  } else if (variantInPool.length > 1) {
    return result({ status: 'uncertain', confidence: 0.5, candidates: variantInPool, reasons: [...reasons, 'Several variants mentioned'] });
  } else {
    const generic = pool.filter((p) => p.variant === null);
    const variants = pool.filter((p) => p.variant !== null);
    if (category === 'specialty_bundle') {
      return result({ status: 'uncertain', confidence: 0.4, candidates: pool, reasons: [...reasons, 'Specialty bundle not identified'] });
    }
    if (pool.length === 1 && variants.length === 1) {
      // Only one product exists for this set + type + edition (e.g. FINAL FANTASY VII Game Edition).
      product = pool[0];
      confidence += 0.25;
      reasons.push(`Only ${product.variant} exists for this type/edition`);
    } else if (generic.length === 1) {
      product = generic[0];
      if (variants.length > 0) {
        confidence += 0.15;
        reasons.push('Variant not named — all variants share this MSRP');
      } else {
        confidence += 0.3;
      }
    } else {
      return result({ status: 'uncertain', confidence: 0.45, candidates: pool, reasons: [...reasons, 'Variant not identified and variants have different MSRPs'] });
    }
  }

  // 6. Quantity / multi-unit listings.
  const q = detectQuantity(n, product.category);
  if (q.ambiguousMulti) {
    return result({ status: 'uncertain', confidence: 0.4, candidates: [product], reasons: [...reasons, 'Listing appears to contain multiple units (case/complete set) but the quantity is unclear'] });
  }
  if (q.units > 1) reasons.push(`Quantity: ${q.units}`);
  if (product.category.endsWith('_box') && q.packCount && product.packCount && q.packCount !== product.packCount) {
    return result({ status: 'uncertain', confidence: 0.4, candidates: [product], reasons: [...reasons, `Listing says ${q.packCount} packs, official box has ${product.packCount}`] });
  }

  // Fuzzy similarity only nudges confidence; it never decides identity.
  const sim = Math.max(diceSimilarity(n, normalizeTitle(product.name)), ...product.aliases.map((a) => diceSimilarity(n, normalizeTitle(`${product!.setName} ${a}`))));
  confidence = Math.min(0.97, confidence + 0.05 * sim);

  const status: MatchStatus = confidence >= CONFIDENCE_THRESHOLD ? 'matched' : 'uncertain';
  return result({ status, product: status === 'matched' ? product : null, candidates: [product, ...pool.filter((p) => p !== product)], confidence, quantity: q.units, listingPackCount: q.packCount, reasons });
}

function uniqueSets(sets: SetRecord[]): SetRecord[] {
  const m = new Map<string, SetRecord>();
  for (const s of sets) m.set(s.code, s);
  return [...m.values()];
}
