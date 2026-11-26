import { parsePrice } from '../core/price';
import type { ParsedPrice } from '../core/types';
import {
  type DetectedItem, type RetailerAdapter, cleanText, findPriceElement, first, heuristicCards, jsonLdPrice, listing, readJsonLdProducts, textOf,
} from './common';

/**
 * Walmart Canada (walmart.ca) — Next.js storefront shared with walmart.com.
 * Strategy order (most stable first):
 *  1. data-item-id product tiles with data-automation-id title/price hooks (test-automation
 *     attributes, far more stable than hashed CSS class names).
 *  2. schema.org JSON-LD + itemprop on product pages (name, gtin13, price).
 *  3. Heuristic: links to /ip/ product pages, climbing to the card containing a price.
 */
const TITLE_SELECTORS = ['[data-automation-id="product-title"]', 'span[data-automation-id="name"]', 'a[link-identifier] span', 'a[href*="/ip/"] span'];
const PRICE_SELECTORS = ['[data-automation-id="product-price"]', '[data-automation-id="price"]', '[data-testid="price-wrap"]'];
export const WALMART_ITEM_ID = /\/ip\/(?:[^/]+\/)?([0-9A-Z]{6,})(?:[/?#]|$)/i;

function tilePrice(card: Element): { price: ParsedPrice | null; anchor: Element | null } {
  const priceEl = first(card, PRICE_SELECTORS);
  if (priceEl) {
    // Screen-reader text holds the canonical "current price $44.96" string.
    const sr = Array.from(priceEl.querySelectorAll('span, div')).find((s) => /current price/i.test(s.textContent ?? ''));
    const p = parsePrice(sr ? textOf(sr).replace(/^.*current price/i, '') : textOf(priceEl));
    if (p) return { price: p, anchor: priceEl };
  }
  const guess = findPriceElement(card);
  return { price: guess ? parsePrice(textOf(guess)) : null, anchor: guess };
}

function scanTiles(doc: Document): DetectedItem[] {
  const items: DetectedItem[] = [];
  const tiles = Array.from(doc.querySelectorAll('[data-item-id]')).filter((t) => !t.parentElement?.closest('[data-item-id]'));
  for (const tile of tiles) {
    const id = tile.getAttribute('data-item-id') || null;
    const link = tile.querySelector<HTMLAnchorElement>('a[href*="/ip/"]');
    const title = textOf(first(tile, TITLE_SELECTORS)) || cleanText(link?.textContent) || cleanText(tile.querySelector('img')?.getAttribute('alt'));
    if (!title) continue;
    const { price, anchor } = tilePrice(tile);
    items.push({
      key: `walmart:${id ?? title}`,
      root: tile,
      anchor: anchor ?? first(tile, TITLE_SELECTORS) ?? tile,
      listing: listing({ retailer: 'walmart', retailerProductId: id, title, price, url: link?.href ?? null, pageType: 'listing' }),
    });
  }
  return items;
}

function scanDetail(doc: Document, url: URL): DetectedItem[] {
  const m = WALMART_ITEM_ID.exec(url.pathname);
  if (!m) return [];
  const ld = readJsonLdProducts(doc)[0];
  const titleEl = first(doc, ['h1#main-title', 'h1[itemprop="name"]', 'main h1', 'h1']);
  const title = textOf(titleEl) || ld?.name || '';
  if (!title) return [];
  const priceEl = first(doc, ['[data-testid="price-wrap"]', '[data-seo-id="hero-price"]', 'span[itemprop="price"]', '[data-automation-id="buybox-price"]']);
  let price: ParsedPrice | null = null;
  if (priceEl) {
    const itemprop = priceEl.matches('[itemprop="price"]') ? priceEl : priceEl.querySelector('[itemprop="price"]');
    const content = itemprop?.getAttribute('content');
    price = content && /^\d+(\.\d+)?$/.test(content) ? { amount: Number(content), currency: 'CAD', raw: content } : parsePrice(textOf(itemprop ?? priceEl));
  }
  price ??= jsonLdPrice(ld);
  const upc = ld?.gtin ?? readSpecUpc(doc);
  const root = titleEl?.closest('section, main, [data-testid="product-details"]') ?? doc.body;
  return [
    {
      key: `walmart:${m[1]}`,
      root,
      anchor: priceEl ?? titleEl ?? root,
      listing: listing({
        retailer: 'walmart', retailerProductId: m[1], title, price, upc, sku: ld?.sku ?? null, description: ld?.description ?? null, url: url.href, pageType: 'detail',
      }),
    },
  ];
}

/** "Universal Product Code (UPC check)  195166289874" in the specifications section. */
function readSpecUpc(doc: Document): string | null {
  const labels = Array.from(doc.querySelectorAll('h3, dt, th, span, div')).filter(
    (e) => e.children.length === 0 && /Universal Product Code|^\s*UPC\s*$|\bGTIN\b/i.test(e.textContent ?? ''),
  );
  for (const l of labels) {
    const near = cleanText(l.nextElementSibling?.textContent ?? l.parentElement?.textContent ?? '');
    const m = /\b(\d{12,14})\b/.exec(near);
    if (m) return m[1];
  }
  return null;
}

export const walmartAdapter: RetailerAdapter = {
  id: 'walmart',
  name: 'Walmart Canada',
  hostnames: /(^|\.)walmart\.ca$/,
  scan(doc, url) {
    const detail = scanDetail(doc, url);
    const tiles = scanTiles(doc).filter((t) => !detail.some((d) => d.key === t.key));
    if (tiles.length || detail.length) return [...detail, ...tiles];
    // Fallback when tile hooks change: heuristic discovery from /ip/ links.
    return heuristicCards(doc, 'a[href*="/ip/"]')
      .map(({ root, link }) => {
        const id = WALMART_ITEM_ID.exec(link.getAttribute('href') ?? '')?.[1] ?? null;
        const title = cleanText(link.textContent) || cleanText(root.querySelector('img')?.getAttribute('alt'));
        const priceEl = findPriceElement(root);
        return {
          key: `walmart:${id ?? title}`,
          root,
          anchor: priceEl ?? link,
          listing: listing({ retailer: 'walmart', retailerProductId: id, title, price: priceEl ? parsePrice(textOf(priceEl)) : null, url: link.href, pageType: 'listing' as const }),
        };
      })
      .filter((i) => i.listing.title);
  },
};
