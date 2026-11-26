import { describe, expect, it } from 'vitest';
import dbJson from '../../data/products.json';
import { BUNDLED_FALLBACK_RATE, effectiveRate, needsRefresh, parseBankOfCanada, REFRESH_INTERVAL_MS } from '../../src/core/fx';
import { classifyTier, compare, convertUsdToCad, percentDifference, resolveReference } from '../../src/core/msrp';
import { parsePrice } from '../../src/core/price';
import { DEFAULT_SETTINGS } from '../../src/core/settings';
import type { ExchangeRate, ProductDatabase } from '../../src/core/types';

const db = dbJson as ProductDatabase;
const T = DEFAULT_SETTINGS.thresholds;
const byId = (id: string) => db.products.find((p) => p.id === id)!;

describe('price parsing', () => {
  const cases: [string, number | null, ('CAD' | 'USD')?][] = [
    ['$49.97', 49.97],
    ['current price $44.96', 44.96],
    ['current price Now $44.96, Was $59.99', 44.96],
    ['Now $159.97 $199.99', 159.97],
    ['$1,299.00', 1299],
    ['49,97 $', 49.97],
    ['1 299,99 $', 1299.99],
    ['CDN$ 54.99', 54.99],
    ['$54.99 CAD', 54.99],
    ['US$39.99', 39.99, 'USD'],
    ['$10.00 - $20.00', null],
    ['$1.50/ea', null],
    ['Free shipping', null],
    ['', null],
    ['79.99', 79.99],
  ];
  for (const [raw, amount, cur] of cases) {
    it(JSON.stringify(raw), () => {
      const p = parsePrice(raw);
      if (amount === null) expect(p).toBeNull();
      else {
        expect(p?.amount).toBe(amount);
        expect(p?.currency).toBe(cur ?? 'CAD');
      }
    });
  }
});

describe('MSRP calculations', () => {
  it('Estimated CAD MSRP = USD MSRP × rate', () => {
    expect(convertUsdToCad(44.99, 1.4219)).toBe(63.97);
    expect(convertUsdToCad(5.25, 1.35)).toBe(7.09);
  });
  it('percentage difference sign convention', () => {
    expect(percentDifference(80, 100)).toBe(-20);
    expect(percentDifference(135, 100)).toBe(35);
    expect(() => percentDifference(10, 0)).toThrow();
  });
  it('tier thresholds are inclusive as specified', () => {
    expect(classifyTier(-20, T)).toBe('great');
    expect(classifyTier(-19.99, T)).toBe('good');
    expect(classifyTier(-5, T)).toBe('good');
    expect(classifyTier(-4.99, T)).toBe('neutral');
    expect(classifyTier(4.99, T)).toBe('neutral');
    expect(classifyTier(5, T)).toBe('high');
    expect(classifyTier(19.99, T)).toBe('high');
    expect(classifyTier(20, T)).toBe('very_high');
  });
  it('custom thresholds are honoured', () => {
    expect(classifyTier(-12, { greatDeal: 10, neutralBand: 2, highMarkup: 10 })).toBe('great');
  });
  it('official comparison end-to-end', () => {
    const ref = resolveReference(byId('eoe--commander-deck--world-shaper'), db)!;
    expect(ref.basis).toBe('official_usd_converted');
    const fx = effectiveRate(null, 1.4, Date.now());
    const c = compare(ref, { amount: 49.94, currency: 'CAD' }, fx, T)!;
    expect(c.msrpCad).toBe(62.99); // 44.99 × 1.4
    expect(c.diffPct).toBeCloseTo(-20.72, 2);
    expect(c.diffAmountCad).toBe(-13.05);
    expect(c.tier).toBe('great');
    expect(c.estimated).toBe(true);
  });
  it('official CAD MSRP takes priority over conversion', () => {
    const p = structuredClone(byId('eoe--bundle'));
    p.msrp.cad = 74.99;
    const ref = resolveReference(p, db)!;
    expect(ref.basis).toBe('official_cad');
    const c = compare(ref, { amount: 74.99, currency: 'CAD' }, null, T)!;
    expect(c.diffPct).toBe(0);
    expect(c.rateUsed).toBeNull();
  });
});

describe('derived benchmarks and missing MSRP', () => {
  it('booster box → combined pack MSRP, never official', () => {
    const ref = resolveReference(byId('eoe--play-booster-box'), db)!;
    expect(ref.basis).toBe('derived_benchmark');
    expect(ref.usd).toBe(164.7); // 30 × 5.49
    expect(ref.derivationLabel).toMatch(/Combined pack MSRP — 30 ×.*estimated benchmark/);
  });
  it('box with no published pack count has no benchmark unless the listing states one', () => {
    const box = byId('fdn--play-booster-box');
    expect(box.msrp.classification).toBe('unavailable');
    expect(resolveReference(box, db)).toBeNull();
    const fromListing = resolveReference(box, db, 1, 36)!;
    expect(fromListing.basis).toBe('derived_benchmark');
    expect(fromListing.usd).toBe(189); // 36 × 5.25
    expect(fromListing.derivationLabel).toMatch(/pack count from retailer listing/);
  });
  it('multi-unit listings multiply into a labelled benchmark', () => {
    const ref = resolveReference(byId('tdm--commander-deck'), db, 5)!;
    expect(ref.basis).toBe('derived_benchmark');
    expect(ref.usd).toBe(224.95);
  });
  it('prerelease packs have explicitly unavailable MSRP', () => {
    const p = byId('eoe--prerelease-kit');
    expect(p.msrp.classification).toBe('unavailable');
    expect(p.msrp.usd).toBeNull();
    expect(resolveReference(p, db)).toBeNull();
  });
  it('every official record cites an official Wizards source', () => {
    for (const p of db.products.filter((x) => x.msrp.classification === 'official')) {
      expect(p.msrp.sourceUrl).toMatch(/^https:\/\/magic\.wizards\.com\//);
      expect(p.msrp.usd).toBeGreaterThan(0);
    }
  });
});

describe('exchange rates', () => {
  const now = Date.parse('2026-11-26T15:00:00Z');
  it('parses the Bank of Canada Valet response', () => {
    const json = { observations: [{ d: '2026-11-24', FXUSDCAD: { v: '1.4180' } }, { d: '2026-11-25', FXUSDCAD: { v: '1.4219' } }] };
    expect(parseBankOfCanada(json)).toEqual({ rate: 1.4219, observationDate: '2026-11-25' });
  });
  it('rejects malformed or implausible responses', () => {
    expect(() => parseBankOfCanada({})).toThrow();
    expect(() => parseBankOfCanada({ observations: [{ d: '2026-11-25', FXUSDCAD: { v: '14.2' } }] })).toThrow();
  });
  it('refreshes roughly every 24 hours, not more', () => {
    const fresh: ExchangeRate = { rate: 1.42, observationDate: '2026-11-25', fetchedAt: now - 3600_000, source: 'bank_of_canada' };
    expect(needsRefresh(fresh, now)).toBe(false);
    expect(needsRefresh({ ...fresh, fetchedAt: now - REFRESH_INTERVAL_MS }, now)).toBe(true);
    expect(needsRefresh(null, now)).toBe(true);
    expect(needsRefresh(BUNDLED_FALLBACK_RATE, now)).toBe(true);
  });
  it('discloses stale rates (last good rate kept)', () => {
    const old: ExchangeRate = { rate: 1.39, observationDate: '2026-11-10', fetchedAt: now - 16 * 86400000, source: 'bank_of_canada' };
    const e = effectiveRate(old, null, now, 'HTTP 503');
    expect(e.rate).toBe(1.39);
    expect(e.stale).toBe(true);
    expect(e.staleReason).toMatch(/16 days old.*HTTP 503/);
  });
  it('a weekend-old rate is not stale', () => {
    const fri: ExchangeRate = { rate: 1.42, observationDate: '2026-11-20', fetchedAt: now, source: 'bank_of_canada' };
    expect(effectiveRate(fri, null, Date.parse('2026-11-23T15:00:00Z')).stale).toBe(false);
  });
  it('bundled fallback is flagged; custom rate overrides', () => {
    expect(effectiveRate(null, null, now).stale).toBe(true);
    const c = effectiveRate(BUNDLED_FALLBACK_RATE, 1.5, now);
    expect(c.rate).toBe(1.5);
    expect(c.source).toBe('custom');
    expect(c.stale).toBe(false);
  });
  it('USD-priced listings are converted before comparing', () => {
    const ref = resolveReference(byId('eoe--bundle'), db)!;
    const c = compare(ref, { amount: 53.99, currency: 'USD' }, effectiveRate(null, 1.4, now), T)!;
    expect(c.diffPct).toBeCloseTo(0, 5);
  });
});
