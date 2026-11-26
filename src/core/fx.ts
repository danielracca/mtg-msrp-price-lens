import type { ExchangeRate } from './types';

export const BOC_URL = 'https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json?recent=1';
export const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** Bank of Canada publishes business days only; allow weekends/holidays before calling a rate stale. */
export const STALE_AFTER_DAYS = 4;

/** Rate shipped with the extension so a first run without network can still convert (always flagged stale-able). */
export const BUNDLED_FALLBACK_RATE: ExchangeRate = {
  rate: 1.4219,
  observationDate: '2026-11-25',
  fetchedAt: Date.parse('2026-11-26T00:00:00Z'),
  source: 'bundled_fallback',
};

export function parseBankOfCanada(json: unknown): { rate: number; observationDate: string } {
  const obs = (json as { observations?: { d: string; FXUSDCAD?: { v: string } }[] })?.observations;
  if (!Array.isArray(obs) || obs.length === 0) throw new Error('No observations in Bank of Canada response');
  const latest = [...obs].sort((a, b) => b.d.localeCompare(a.d))[0];
  const rate = Number(latest.FXUSDCAD?.v);
  if (!Number.isFinite(rate) || rate < 0.8 || rate > 2.5) throw new Error(`Implausible USD/CAD rate: ${latest.FXUSDCAD?.v}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(latest.d)) throw new Error(`Bad observation date ${latest.d}`);
  return { rate, observationDate: latest.d };
}

/** True when the cached rate should be re-fetched (approx. every 24h). */
export function needsRefresh(cached: ExchangeRate | null | undefined, now: number): boolean {
  if (!cached || cached.source !== 'bank_of_canada') return true;
  return now - cached.fetchedAt >= REFRESH_INTERVAL_MS;
}

export function daysBetween(isoDate: string, now: number): number {
  const t = Date.parse(`${isoDate}T12:00:00Z`);
  return Math.floor((now - t) / 86400000);
}

export interface EffectiveRate extends ExchangeRate {
  stale: boolean;
  staleReason: string | null;
}

/**
 * Chooses the rate used for conversions: user custom rate > fetched BoC rate > bundled fallback.
 * Staleness is disclosed, never hidden.
 */
export function effectiveRate(
  cached: ExchangeRate | null | undefined,
  customRate: number | null | undefined,
  now: number,
  lastError?: string | null,
): EffectiveRate {
  if (customRate && customRate > 0) {
    return { rate: customRate, observationDate: new Date(now).toISOString().slice(0, 10), fetchedAt: now, source: 'custom', stale: false, staleReason: null };
  }
  const base = cached ?? BUNDLED_FALLBACK_RATE;
  const age = daysBetween(base.observationDate, now);
  let staleReason: string | null = null;
  if (base.source === 'bundled_fallback') staleReason = 'Using the rate bundled with the extension — live rate not retrieved yet';
  else if (age > STALE_AFTER_DAYS) staleReason = `Rate is ${age} days old${lastError ? ` (last refresh failed: ${lastError})` : ''}`;
  return { ...base, stale: staleReason !== null, staleReason };
}
