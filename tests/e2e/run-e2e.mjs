// End-to-end test: loads the built unpacked extension into Chromium and serves the local
// Walmart.ca fixture at the real walmart.ca URL (request interception — the live site is
// never contacted). Verifies badges, popover, infinite scroll, re-render dedupe, SPA
// navigation and the popup summary. Usage: npm run test:e2e  (builds first)
import { mkdirSync, readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let playwright;
try {
  playwright = require('playwright');
} catch {
  playwright = require(join(process.env.NODE_PATH || '/usr/local/lib/node_modules', 'playwright'));
}
const { chromium } = playwright;

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ext = join(root, '.output/chrome-mv3');
const shots = join(root, 'tests/e2e/screenshots');
mkdirSync(shots, { recursive: true });
const fixture = (n) => readFileSync(join(root, 'tests/fixtures', n), 'utf8');

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✓' : '✗'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures++;
};

const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'mtgpl-')), {
  headless: true,
  channel: 'chromium', // new headless mode supports extensions
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  viewport: { width: 1280, height: 900 },
  deviceScaleFactor: 2,
});

await ctx.route('https://www.walmart.ca/**', (route) => {
  const u = new URL(route.request().url());
  if (u.pathname.startsWith('/en/search')) return route.fulfill({ contentType: 'text/html', body: fixture('walmart-search.html') });
  if (u.pathname.startsWith('/en/ip/')) return route.fulfill({ contentType: 'text/html', body: fixture('walmart-product.html') });
  return route.fulfill({ status: 204, body: '' });
});

let [sw] = ctx.serviceWorkers();
sw ??= await ctx.waitForEvent('serviceworker');
const extId = new URL(sw.url()).host;
check('extension service worker started', !!extId, extId);

const page = await ctx.newPage();
await page.goto('https://www.walmart.ca/en/search?q=magic+the+gathering');
await page.waitForSelector('mtg-price-lens-badge', { timeout: 10000 });
await page.waitForTimeout(400);

const badgeInfo = () =>
  page.$$eval('mtg-price-lens-badge', (els) => els.map((e) => ({ key: e.dataset.key, text: e.shadowRoot.querySelector('button').textContent, hidden: e.hidden })));

let badges = await badgeInfo();
check('badges injected under sealed products', badges.length === 10, `${badges.length} badges`);
check('sleeves / Pokemon ignored', !badges.some((b) => ['walmart:6000209010009', 'walmart:6000209010011'].includes(b.key)));
let fxRate = null;
for (let i = 0; i < 40 && !fxRate; i++) {
  fxRate = await sw.evaluate(async () => (await chrome.storage.local.get('fxCache')).fxCache);
  if (!fxRate) await page.waitForTimeout(250);
}
check('live Bank of Canada rate fetched by service worker', fxRate?.source === 'bank_of_canada', fxRate ? `${fxRate.rate} (${fxRate.observationDate})` : 'not fetched (network?)');

const ws = badges.find((b) => b.key === 'walmart:6000209010004');
check('commander deck badge shows % vs MSRP', /% (below|above) MSRP|At MSRP/.test(ws?.text ?? ''), ws?.text);
check('booster box labelled as estimated benchmark', /benchmark/.test(badges.find((b) => b.key === 'walmart:6000209010003')?.text ?? ''));
check('legacy set shows MSRP unavailable', /MSRP unavailable/.test(badges.find((b) => b.key === 'walmart:6000209010008')?.text ?? ''));
check('ambiguous product shows match uncertain', /uncertain/.test(badges.find((b) => b.key === 'walmart:6000209010010')?.text ?? ''));

// Retailer CSS isolation: the fixture styles all buttons hotpink with 30px font.
const style = await page.$eval('mtg-price-lens-badge', (e) => {
  const cs = getComputedStyle(e.shadowRoot.querySelector('button'));
  return { bg: cs.backgroundColor, size: cs.fontSize };
});
check('retailer CSS does not leak into badge', style.size === '12px' && !/255, 105, 180/.test(style.bg), JSON.stringify(style));
await page.screenshot({ path: join(shots, '1-walmart-search.png') });

// Popover
await page.locator('mtg-price-lens-badge[data-key="walmart:6000209010004"]').locator('button').click();
await page.waitForTimeout(300);
const pop = await page.$eval('mtg-price-lens-overlay', (e) => e.shadowRoot.textContent);
check('popover shows product, official USD MSRP, estimated CAD MSRP, rate, confidence', /World Shaper/.test(pop) && /\$44\.99 USD/.test(pop) && /Estimated CAD MSRP/.test(pop) && /1 USD = /.test(pop) && /Match confidence/.test(pop));
const href = await page.$eval('mtg-price-lens-overlay', (e) => e.shadowRoot.querySelector('a')?.href);
check('popover links official MSRP source', href === 'https://magic.wizards.com/en/news/feature/collecting-edge-of-eternities', href);
await page.locator('mtg-price-lens-badge[data-key="walmart:6000209010004"]').scrollIntoViewIfNeeded();
await page.screenshot({ path: join(shots, '2-popover.png') });
await page.keyboard.press('Escape');

// Uncertain → manual selection, remembered
await page.locator('mtg-price-lens-badge[data-key="walmart:6000209010010"]').locator('button').click();
await page.waitForTimeout(200);
await page.locator('mtg-price-lens-overlay').locator('input[type=search]').fill('multiverse reforged');
await page.waitForTimeout(100);
await page.screenshot({ path: join(shots, '3-manual-match.png') });
await page.locator('mtg-price-lens-overlay').locator('li button').first().click();
await page.waitForTimeout(400);
badges = await badgeInfo();
const fixed = badges.find((b) => b.key === 'walmart:6000209010010');
check('manual correction applied', /MSRP/.test(fixed?.text ?? '') && !/uncertain/.test(fixed?.text ?? ''), fixed?.text);
const mappings = await sw.evaluate(async () => (await chrome.storage.local.get('manualMappings')).manualMappings);
check('manual correction stored locally', mappings?.['walmart:6000209010010'] === 'fra--commander-deck--multiverse-reforged');
await page.keyboard.press('Escape');

// Infinite scroll
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await page.waitForTimeout(900);
badges = await badgeInfo();
check('infinite-scroll products get badges', badges.length === 13, `${badges.length} badges`);

// React-style re-render must not duplicate
await page.evaluate(() => window.__rerenderFirst());
await page.waitForTimeout(600);
const perTile = await page.$$eval('[data-item-id]', (ts) => ts.map((t) => t.querySelectorAll('mtg-price-lens-badge').length));
check('no duplicate badges after re-render', perTile.every((n) => n <= 1) && perTile[0] === 1, JSON.stringify(perTile));

// Popup summary
// Without the "tabs" permission URLs are hidden, so find the store tab by asking each tab's content script.
const tabId = await sw.evaluate(async () => {
  for (const t of await chrome.tabs.query({})) {
    try {
      const r = await chrome.tabs.sendMessage(t.id, { type: 'MTGPL_GET_SUMMARY' });
      if (r?.retailer) return t.id;
    } catch {}
  }
  return null;
});
const popup = await ctx.newPage(); popup.on('pageerror', (e) => console.log('popup error:', e.message));
await popup.setViewportSize({ width: 380, height: 600 });
await popup.goto(`chrome-extension://${extId}/popup.html?tabId=${tabId}`);
await popup.waitForSelector('.stats', { timeout: 5000 });
const popText = await popup.textContent('body');
check('popup shows counts', /13\s*Detected/.test(popText), popText.slice(0, 160));
check('popup shows best verified deal', /Best verified deal/.test(popText) && /below MSRP/.test(popText));
check('popup shows exchange rate and database version', /1 USD = \d\.\d{4} CAD/.test(popText) && /MSRP database\s*v20/.test(popText));
await popup.screenshot({ path: join(shots, '4-popup.png'), fullPage: true });
await popup.click('text=Settings');
await popup.screenshot({ path: join(shots, '5-settings.png'), fullPage: true });

// Settings take effect live: show only below MSRP
await popup.click('text=Show only products below MSRP');
await page.waitForTimeout(500);
badges = await badgeInfo();
check('"show only below MSRP" hides non-deals', badges.some((b) => b.hidden) && badges.filter((b) => !b.hidden).every((b) => /below/.test(b.text)));
await popup.click('text=Show only products below MSRP');
await popup.close();

// SPA pagination
await page.evaluate(() => window.scrollTo(0, 0));
await page.evaluate(() => document.getElementById('next').click());
await page.waitForTimeout(600);
badges = await badgeInfo();
check('SPA navigation re-scans new grid', badges.length === 2 && badges.some((b) => b.key === 'walmart:6000209020001'), `${badges.length} badges`);

// Product page
const pp = await ctx.newPage();
await pp.goto('https://www.walmart.ca/en/ip/magic-the-gathering-tarkir-dragonstorm-play-booster-box/6000209030001');
await pp.waitForSelector('mtg-price-lens-badge', { timeout: 10000 });
const ppBadges = await pp.$$eval('mtg-price-lens-badge', (els) => els.map((e) => e.shadowRoot.textContent));
check('product detail page badge', ppBadges.length === 2 && /benchmark/.test(ppBadges[0]), JSON.stringify(ppBadges.map((t) => t.replace(/[\s\S]*}\s*/, ''))));
await pp.screenshot({ path: join(shots, '6-product-page.png') });

await ctx.close();
console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll e2e checks passed');
process.exit(failures ? 1 : 0);
