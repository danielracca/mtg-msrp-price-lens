import type { BadgeState } from '../content/evaluate';
import type { Basis, Tier } from '../core/msrp';

export interface SummaryItem {
  key: string;
  title: string;
  productName: string | null;
  state: BadgeState;
  priceCad: number | null;
  msrpCad: number | null;
  diffPct: number | null;
  tier: Tier | null;
  basis: Basis | null;
  confidence: number;
}

export interface PageSummary {
  retailer: string;
  url: string;
  total: number;
  below: number;
  above: number;
  atMsrp: number;
  unavailable: number;
  uncertain: number;
  bestDeal: SummaryItem | null;
  items: SummaryItem[];
}

export type Message =
  | { type: 'MTGPL_GET_SUMMARY' }
  | { type: 'MTGPL_REVEAL'; key: string }
  | { type: 'MTGPL_REFRESH_FX' }
  | { type: 'MTGPL_REFRESH_DB' };

export interface RefreshResult {
  ok: boolean;
  message: string;
}
