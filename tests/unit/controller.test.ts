import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import dbJson from '../../data/products.json';
import { BADGE_TAG } from '../../src/adapters/common';
import { walmartAdapter } from '../../src/adapters/walmart';
import { PageController } from '../../src/content/controller';
import { effectiveRate } from '../../src/core/fx';
import { DEFAULT_SETTINGS } from '../../src/core/settings';
import type { ProductDatabase } from '../../src/core/types';

const html = readFileSync(join(__dirname, '../fixtures/walmart-search.html'), 'utf8');
const db = dbJson as ProductDatabase;
const fx = effectiveRate({ rate: 1.4, observationDate: '2026-11-25', fetchedAt: Date.now(), source: 'bank_of_canada' }, null, Date.now());

function load() {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  document.body.innerHTML = doc.body.innerHTML.replace(/<script>[\s\S]*?<\/script>/g, '');
}
const badges = () => Array.from(document.querySelectorAll<HTMLElement>(BADGE_TAG));
const badgeText = (key: string) => badges().find((b) => b.dataset.key === key)?.shadowRoot?.querySelector('button')?.textContent ?? null;

let saved: Record<string, string | null> = {};
const make = (settings = DEFAULT_SETTINGS) =>
  new PageController(walmartAdapter, { db, settings, fx, mappings: {} }, { saveMapping: async (k, v) => void (saved[k] = v) });

beforeEach(() => {
  saved = {};
  history.replaceState({}, '', '/en/search?q=magic+the+gathering');
  load();
});
afterEach(() => vi.useRealTimers());

describe('badge injection', () => {
  it('renders one badge per eligible product and ignores non-sealed items', () => {
    const c = make();
    c.scan();
    // 12 tiles: sleeves + Pokemon are ignored → 10 badges.
    expect(badges()).toHaveLength(10);
    expect(document.querySelector('[data-item-id="6000209010009"] ' + BADGE_TAG)).toBeNull();
    expect(document.querySelector('[data-item-id="6000209010011"] ' + BADGE_TAG)).toBeNull();
  });
  it('places the badge directly after the price element', () => {
    make().scan();
    const tile = document.querySelector('[data-item-id="6000209010004"]')!;
    expect(tile.querySelector('[data-automation-id="product-price"]')!.nextElementSibling!.tagName.toLowerCase()).toBe(BADGE_TAG);
  });
  it('shows the expected states', () => {
    make().scan();
    expect(badgeText('walmart:6000209010004')).toMatch(/20% below MSRP/); // 49.94 vs 44.99×1.4=62.99
    expect(badgeText('walmart:6000209010005')).toMatch(/42% above MSRP/); // 179.99 vs 89.99×1.4=125.99
    expect(badgeText('walmart:6000209010003')).toMatch(/19% below est\. benchmark/); // box: 184.97 vs 30×5.49×1.4
    expect(badgeText('walmart:6000209010008')).toMatch(/MSRP unavailable/); // Duskmourn (pre-Foundations)
    expect(badgeText('walmart:6000209010010')).toMatch(/Product match uncertain/); // RF decks have different MSRPs
  });
  it('never duplicates badges on repeated scans', () => {
    const c = make();
    c.scan();
    c.scan();
    c.scan(true);
    expect(badges()).toHaveLength(10);
    for (const tile of Array.from(document.querySelectorAll('[data-item-id]'))) expect(tile.querySelectorAll(BADGE_TAG).length).toBeLessThanOrEqual(1);
  });
  it('re-attaches a badge when a card is re-rendered (React hydration)', () => {
    const c = make();
    c.scan();
    const tile = document.querySelector('[data-item-id="6000209010001"]')!;
    const fresh = tile.cloneNode(true) as Element;
    fresh.querySelectorAll(BADGE_TAG).forEach((b) => b.remove());
    tile.replaceWith(fresh);
    c.scan();
    expect(fresh.querySelectorAll(BADGE_TAG)).toHaveLength(1);
    expect(badges()).toHaveLength(10);
  });
  it('uses Shadow DOM so retailer CSS cannot style the badge', () => {
    make().scan();
    const b = badges()[0];
    expect(b.shadowRoot).not.toBeNull();
    expect(b.shadowRoot!.querySelector('style')!.textContent).toContain('all: unset');
  });
});

describe('dynamic content', () => {
  it('badges products appended later (infinite scroll) via MutationObserver', async () => {
    vi.useFakeTimers();
    const c = make();
    c.start();
    expect(badges()).toHaveLength(10);
    const extra = document.querySelector('[data-item-id="6000209010001"]')!.cloneNode(true) as Element;
    extra.querySelectorAll(BADGE_TAG).forEach((b) => b.remove());
    extra.setAttribute('data-item-id', '6000209099999');
    extra.querySelector('[data-automation-id="product-title"]')!.textContent = 'Magic: The Gathering Edge of Eternities Collector Booster';
    document.getElementById('grid')!.appendChild(extra);
    await vi.advanceTimersByTimeAsync(0); // flush MutationObserver microtask
    await vi.advanceTimersByTimeAsync(250); // debounce
    expect(badges()).toHaveLength(11);
    expect(extra.querySelectorAll(BADGE_TAG)).toHaveLength(1);
    c.stop();
  });
  it('handles SPA navigation that replaces the grid', async () => {
    vi.useFakeTimers();
    const c = make();
    c.start();
    history.pushState({}, '', '/en/search?q=magic+the+gathering&page=2');
    const grid = document.getElementById('grid')!;
    const keep = grid.querySelector('[data-item-id="6000209010012"]')!.cloneNode(true) as Element;
    keep.querySelectorAll(BADGE_TAG).forEach((b) => b.remove());
    grid.replaceChildren(keep);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(250);
    expect(badges()).toHaveLength(1);
    expect(c.summary().total).toBe(1);
    c.stop();
  });
});

describe('settings, summary and manual corrections', () => {
  it('summary counts and best verified deal', () => {
    const c = make();
    c.scan();
    const s = c.summary();
    expect(s.total).toBe(10);
    expect(s.uncertain).toBe(1);
    expect(s.unavailable).toBe(1);
    expect(s.bestDeal?.key).toBe('walmart:6000209010004'); // benchmarks never count as "verified"
    expect(s.below + s.above + s.atMsrp).toBe(8);
  });
  it('"show only below MSRP" hides other badges without removing them', () => {
    make({ ...DEFAULT_SETTINGS, showOnlyBelowMsrp: true }).scan();
    const visible = badges().filter((b) => !b.hidden);
    expect(visible.length).toBeGreaterThan(0);
    for (const b of visible) expect(b.shadowRoot!.textContent).toMatch(/below/);
  });
  it('hiding estimated benchmarks removes derived comparisons', () => {
    make({ ...DEFAULT_SETTINGS, showEstimatedBenchmarks: false }).scan();
    expect(badgeText('walmart:6000209010003')).toMatch(/No official MSRP/);
  });
  it('disabling badges hides all of them', () => {
    make({ ...DEFAULT_SETTINGS, badgesEnabled: false }).scan();
    expect(badges().every((b) => b.hidden)).toBe(true);
  });
  it('a manual correction resolves an uncertain match and is persisted', async () => {
    const c = new PageController(walmartAdapter, { db, settings: DEFAULT_SETTINGS, fx, mappings: { 'walmart:6000209010010': 'fra--commander-deck--multiverse-reforged' } }, { saveMapping: async () => {} });
    c.scan();
    expect(badgeText('walmart:6000209010010')).toMatch(/at MSRP|below MSRP|above MSRP/i);
    const item = c.items().find((i) => i.key === 'walmart:6000209010010')!;
    expect(item.manual).toBe(true);
    expect(item.match.confidence).toBe(1);
  });
  it('popover opens on badge click with comparison details and the official source link', async () => {
    const c = make();
    c.scan();
    const b = badges().find((x) => x.dataset.key === 'walmart:6000209010004')!;
    b.shadowRoot!.querySelector('button')!.click();
    await new Promise((r) => setTimeout(r, 20));
    const overlay = document.querySelector('mtg-price-lens-overlay')!;
    const text = overlay.shadowRoot!.textContent!;
    expect(text).toContain('Edge of Eternities World Shaper Commander Deck');
    expect(text).toContain('Official MSRP (USD)');
    expect(text).toContain('$44.99 USD');
    expect(text).toContain('Estimated CAD MSRP');
    expect(text).toContain('1 USD = 1.4000 CAD');
    expect(overlay.shadowRoot!.querySelector('a')!.getAttribute('href')).toBe('https://magic.wizards.com/en/news/feature/collecting-edge-of-eternities');
    c.stop();
  });
});
