import type { ProductDatabase, ProductRecord } from './types';

export interface ValidationIssue {
  level: 'error' | 'warning';
  productId?: string;
  message: string;
}

const CATEGORIES = new Set([
  'play_booster_pack', 'play_booster_box', 'collector_booster_pack', 'collector_booster_box', 'jumpstart_booster_pack',
  'bundle', 'gift_bundle', 'specialty_bundle', 'commander_deck', 'commander_bundle', 'prerelease_kit', 'scene_box',
  'starter_kit', 'beginner_box', 'starter_collection', 'theme_deck', 'draft_night', 'other_sealed',
]);
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Validates schema, required fields, classification consistency and duplicates. */
export function validateDatabase(db: ProductDatabase): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const err = (message: string, productId?: string) => issues.push({ level: 'error', message, productId });
  const warn = (message: string, productId?: string) => issues.push({ level: 'warning', message, productId });

  if (db.schemaVersion !== 1) err(`Unsupported schemaVersion ${db.schemaVersion}`);
  if (!db.dbVersion) err('dbVersion missing');
  const setCodes = new Set(db.sets.map((s) => s.code));
  const ids = new Set<string>();
  const signature = new Map<string, string>();
  const byId = new Map(db.products.map((p) => [p.id, p] as const));

  for (const p of db.products) {
    if (!p.id) err('Product without id');
    if (ids.has(p.id)) err(`Duplicate product id ${p.id}`, p.id);
    ids.add(p.id);
    if (!p.name) err('Missing name', p.id);
    if (!setCodes.has(p.setCode)) err(`Unknown set code ${p.setCode}`, p.id);
    if (!CATEGORIES.has(p.category)) err(`Unknown category ${p.category}`, p.id);
    if (p.releaseDate && !ISO.test(p.releaseDate)) err(`Bad releaseDate ${p.releaseDate}`, p.id);
    if (!ISO.test(p.lastVerified)) err(`Bad lastVerified ${p.lastVerified}`, p.id);
    if (!Array.isArray(p.aliases) || !Array.isArray(p.upc)) err('aliases/upc must be arrays', p.id);
    for (const u of p.upc) if (!/^\d{8,14}$/.test(u)) err(`Invalid UPC ${u}`, p.id);
    validateMsrp(p, byId, err, warn);
    if (p.verification === 'needs_review') warn('Flagged for manual review', p.id);

    const sig = `${p.setCode}|${p.category}|${p.variant ?? ''}|${p.edition}`;
    if (signature.has(sig)) err(`Duplicate product signature with ${signature.get(sig)}`, p.id);
    signature.set(sig, p.id);
  }

  // Same UPC on two records is a data error.
  const upcs = new Map<string, string>();
  for (const p of db.products) for (const u of p.upc) {
    if (upcs.has(u)) err(`UPC ${u} shared with ${upcs.get(u)}`, p.id);
    upcs.set(u, p.id);
  }
  return issues;
}

function validateMsrp(
  p: ProductRecord,
  byId: Map<string, ProductRecord>,
  err: (m: string, id?: string) => void,
  warn: (m: string, id?: string) => void,
) {
  const m = p.msrp;
  if (!m) return err('Missing msrp block', p.id);
  switch (m.classification) {
    case 'official':
      if (typeof m.usd !== 'number' && typeof m.cad !== 'number') err('Official MSRP without a value', p.id);
      if (typeof m.usd === 'number' && (m.usd <= 0 || m.usd > 2000)) err(`Implausible USD MSRP ${m.usd}`, p.id);
      if (!m.sourceUrl) err('Official MSRP without source URL', p.id);
      if (m.sourceUrl && !/^https:\/\/magic\.wizards\.com\//.test(m.sourceUrl)) warn('Official MSRP source is not magic.wizards.com', p.id);
      if (m.derivation) err('Official MSRP must not carry a derivation', p.id);
      break;
    case 'derived': {
      if (m.usd !== null || m.cad !== null) err('Derived benchmark must not store an official value', p.id);
      if (!m.derivation) return err('Derived benchmark without derivation', p.id);
      const base = byId.get(m.derivation.fromProductId);
      if (!base) err(`Derivation base ${m.derivation.fromProductId} missing`, p.id);
      else if (base.msrp.classification !== 'official') err('Derivation base is not an official MSRP', p.id);
      if (!(m.derivation.quantity > 1)) err('Derivation quantity must be > 1', p.id);
      break;
    }
    case 'unavailable':
      if (m.usd !== null || m.cad !== null) err('Unavailable MSRP must not have a value', p.id);
      break;
    default:
      err(`Unknown classification ${(m as { classification: string }).classification}`, p.id);
  }
}
