/**
 * Core data model for MTG Price Lens.
 *
 * Pricing classifications are kept strictly separate:
 *  - "official"    → an MSRP published by Wizards of the Coast for this exact product.
 *  - "derived"     → an estimated benchmark computed from official MSRPs (e.g. 30 × Play Booster MSRP).
 *                    Never presented as an official MSRP.
 *  - "unavailable" → Wizards did not publish an MSRP for this product.
 */

export type ProductCategory =
  | 'play_booster_pack'
  | 'play_booster_box'
  | 'collector_booster_pack'
  | 'collector_booster_box'
  | 'jumpstart_booster_pack'
  | 'bundle'
  | 'gift_bundle'
  | 'specialty_bundle'
  | 'commander_deck'
  | 'commander_bundle'
  | 'prerelease_kit'
  | 'scene_box'
  | 'starter_kit'
  | 'beginner_box'
  | 'starter_collection'
  | 'theme_deck'
  | 'draft_night'
  | 'other_sealed';

export type MsrpClassification = 'official' | 'derived' | 'unavailable';

export type VerificationStatus =
  | 'verified' // value read from an official Wizards source and checked
  | 'needs_review' // ingested automatically but conflicting/ambiguous
  | 'unverified';

export interface MsrpInfo {
  classification: MsrpClassification;
  /** Official USD MSRP (classification === 'official'). */
  usd: number | null;
  /** Official CAD MSRP, only when Wizards explicitly publishes one. */
  cad: number | null;
  /** For derived benchmarks: how the value is computed at runtime. */
  derivation?: {
    method: 'combined_pack_msrp';
    fromProductId: string;
    quantity: number;
  };
  sourceUrl: string | null;
  sourceTitle: string | null;
  /** ISO date the source was published. */
  sourcePublishedDate: string | null;
  /** Original label used in the source, e.g. "Commander Deck: $44.99". */
  sourceLabel?: string;
  note?: string;
}

export interface ProductRecord {
  id: string;
  name: string;
  aliases: string[];
  setName: string;
  setCode: string;
  category: ProductCategory;
  /** Named variant (e.g. Commander deck name) or edition qualifier. */
  variant: string | null;
  /** Edition: standard vs premium/collector's edition releases. */
  edition: 'standard' | 'collectors_edition' | 'premium_edition' | 'game_edition';
  releaseDate: string | null;
  upc: string[];
  packCount: number | null;
  msrp: MsrpInfo;
  lastVerified: string;
  verification: VerificationStatus;
}

export interface SetRecord {
  code: string;
  name: string;
  aliases: string[];
  releaseDate: string | null;
  /** Universes Beyond sets have different pricing tiers. */
  universesBeyond: boolean;
  sourceUrl: string | null;
  /** Products whose names imply another set, e.g. "Foundations Commander Deck" belongs to Reality Fracture. */
  hasMsrp: boolean;
}

export interface LegacySet {
  name: string;
  aliases: string[];
  reason: string;
}

export interface ProductDatabase {
  schemaVersion: 1;
  dbVersion: string;
  generatedAt: string;
  coverageNote: string;
  sets: SetRecord[];
  legacySets: LegacySet[];
  products: ProductRecord[];
}

/** Data extracted from a retailer listing by an adapter. */
export interface RetailerListing {
  retailer: string;
  /** Stable per-retailer product ID (Walmart item ID, ASIN, SKU…) when available. */
  retailerProductId: string | null;
  title: string;
  price: ParsedPrice | null;
  upc: string | null;
  sku: string | null;
  description: string | null;
  url: string | null;
  pageType: 'listing' | 'detail';
}

export interface ParsedPrice {
  amount: number;
  currency: 'CAD' | 'USD';
  raw: string;
}

export interface ExchangeRate {
  /** CAD per 1 USD. */
  rate: number;
  /** Date of the observation (ISO yyyy-mm-dd). */
  observationDate: string;
  /** Epoch ms when it was fetched. */
  fetchedAt: number;
  source: 'bank_of_canada' | 'custom' | 'bundled_fallback';
}
