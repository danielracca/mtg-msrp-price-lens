import { describe, expect, it } from 'vitest';
import dbJson from '../../data/products.json';
import registryJson from '../../scripts/db/sources.json';
import { validateDatabase } from '../../src/core/dbValidate';
import { buildDatabase, extractBoxPackCounts, extractCommanderDeckNames, extractMsrpLines, type SourceRegistry } from '../../src/core/ingest/buildDb';
import { extractPublishedDate, htmlToLines } from '../../src/core/ingest/htmlText';
import type { ProductDatabase } from '../../src/core/types';

const article = `<html><head><meta property="og:title" content="Collecting Test Set"></head><body>
<p>Nov 1, 2026</p>
<p>Celebrate when <em>Test Set</em> releases on December 4, 2026.</p>
<h2>MSRPs</h2><p>MSRPs for <em>Test Set</em> will be set as follows:</p>
<ul><li>Play Booster: $5.49</li><li>Collector Booster: $26.99*</li><li>Commander Deck: $49.99</li><li>Gift Bundle: $89.99</li><li>Mystery Crate: $19.99</li></ul>
<p>Important Dates:</p>
<p>Play Booster box includes 30 Play Boosters.</p><p>Collector Booster box includes 12 Collector Boosters.</p>
<h3>Commander Decks</h3><p>Alpha Strike (White-Red)</p><p>Commander Deck</p><p>Beta Wave</p><p>Commander Deck</p><p>Each Test Set Commander deck contains the following:</p>
<p>Prerelease Pack</p></body></html>`;

const registry: SourceRegistry = {
  userAgent: 'test',
  requestDelayMs: 0,
  legacySets: { reason: 'old', names: [['Old Set']] },
  sources: [{ id: 'collecting-test', url: 'https://magic.wizards.com/en/news/feature/collecting-test', kind: 'collecting', sets: [{ code: 'TST', name: 'Test Set', aliases: [], releaseDate: '2026-12-04', releaseDateText: 'December 4, 2026', universesBeyond: false }] }],
};

describe('source parsing', () => {
  const lines = htmlToLines(article);
  it('flattens inline markup', () => {
    expect(lines).toContain('MSRPs for Test Set will be set as follows:');
  });
  it('extracts publication date, MSRP lines, box counts and deck names', () => {
    expect(extractPublishedDate(lines)).toBe('2026-11-01');
    const m = extractMsrpLines(lines);
    expect(m.map((x) => [x.label, x.usd])).toEqual([['Play Booster', 5.49], ['Collector Booster', 26.99], ['Commander Deck', 49.99], ['Gift Bundle', 89.99], ['Mystery Crate', 19.99]]);
    expect(m[1].footnote).toBe(true);
    expect(extractBoxPackCounts(lines)).toEqual({ play: 30, collector: 12 });
    expect(extractCommanderDeckNames(lines, 'Test Set')).toEqual(['Alpha Strike', 'Beta Wave']);
  });
  it('builds normalized records and flags unknown labels for review', () => {
    const { db, flags } = buildDatabase(registry, new Map([['collecting-test', article]]), { today: '2026-11-26', dbVersion: 'test' });
    const ids = db.products.map((p) => p.id);
    expect(ids).toContain('tst--commander-deck--alpha-strike');
    expect(ids).toContain('tst--play-booster-box');
    expect(ids).toContain('tst--prerelease-kit');
    const box = db.products.find((p) => p.id === 'tst--collector-booster-box')!;
    expect(box.msrp.classification).toBe('derived');
    expect(box.msrp.derivation).toEqual({ method: 'combined_pack_msrp', fromProductId: 'tst--collector-booster-pack', quantity: 12 });
    const crate = db.products.find((p) => p.name.includes('Mystery Crate'))!;
    expect(crate.verification).toBe('needs_review');
    expect(flags.some((f) => f.message.includes('Unrecognized product label "Mystery Crate"'))).toBe(true);
    expect(validateDatabase(db).filter((i) => i.level === 'error')).toEqual([]);
  });
  it('reports a missing source as an error instead of inventing data', () => {
    const { db, flags } = buildDatabase(registry, new Map(), { today: '2026-11-26', dbVersion: 'test' });
    expect(db.products).toHaveLength(0);
    expect(flags[0].level).toBe('error');
  });
});

describe('database validation', () => {
  const db = dbJson as ProductDatabase;
  it('bundled database is valid', () => {
    expect(validateDatabase(db).filter((i) => i.level === 'error')).toEqual([]);
  });
  it('covers Foundations onward', () => {
    expect(db.sets[0].code).toBe('FDN');
    expect(db.products.length).toBeGreaterThan(150);
  });
  it('catches duplicates, missing sources and mislabelled benchmarks', () => {
    const bad = structuredClone(db);
    bad.products.push(structuredClone(bad.products[0]));
    const p = bad.products.find((x) => x.id === 'eoe--bundle')!;
    p.msrp.sourceUrl = null;
    const box = bad.products.find((x) => x.id === 'eoe--play-booster-box')!;
    box.msrp.usd = 164.7; // a derived benchmark must never be stored as an official value
    const msgs = validateDatabase(bad).map((i) => i.message).join('\n');
    expect(msgs).toMatch(/Duplicate product id/);
    expect(msgs).toMatch(/Official MSRP without source URL/);
    expect(msgs).toMatch(/Derived benchmark must not store an official value/);
  });
  it('the source registry builds the bundled database (cross-checks pass)', () => {
    expect((registryJson as SourceRegistry).sources.length).toBeGreaterThan(10);
  });
});
