import { parsePrice } from '../core/price';
import type { ParsedPrice } from '../core/types';
import {
  type DetectedItem, type RetailerAdapter, cleanText, findPriceElement, first, heuristicCards, jsonLdPrice, listing, priceFrom, readJsonLdProducts, textOf,
} from './common';

/* ------------------------------------------------------------------ */
/* Amazon.ca                                                           */
/* ------------------------------------------------------------------ */

const ASIN_FROM_URL = /\/(?:dp|gp\/product)\/([A-Z0-9]{10})/;

export const amazonAdapter: RetailerAdapter = {
  id: 'amazon',
  name: 'Amazon.ca',
  hostnames: /(^|\.)amazon\.ca$/,
  scan(doc, url) {
    const items: DetectedItem[] = [];
    // Search results: data-asin + data-component-type are stable hooks used by Amazon's own tooling.
    doc.querySelectorAll('div[data-component-type="s-search-result"][data-asin]').forEach((card) => {
      const asin = card.getAttribute('data-asin');
      if (!asin) return;
      const title = cleanText(card.querySelector('h2')?.getAttribute('aria-label')) || textOf(card.querySelector('h2'));
      const priceBox = card.querySelector('.a-price:not(.a-text-price)');
      const price = parsePrice(textOf(priceBox?.querySelector('.a-offscreen')));
      if (!title) return;
      items.push({
        key: `amazon:${asin}`,
        root: card,
        anchor: priceBox?.closest('[data-cy="price-recipe"]') ?? priceBox ?? card.querySelector('h2') ?? card,
        listing: listing({ retailer: 'amazon', retailerProductId: asin, title, price, url: card.querySelector<HTMLAnchorElement>('h2 a, a.a-link-normal')?.href ?? null, pageType: 'listing' }),
      });
    });
    // Product page.
    const asin = (doc.querySelector<HTMLInputElement>('input#ASIN')?.value || ASIN_FROM_URL.exec(url.pathname)?.[1]) ?? null;
    const titleEl = doc.querySelector('#productTitle');
    if (asin && titleEl) {
      const priceBox = first(doc, ['#corePrice_feature_div .a-price:not(.a-text-price)', '#corePriceDisplay_desktop_feature_div .a-price:not(.a-text-price)', '#apex_desktop .a-price:not(.a-text-price)', '#price_inside_buybox']);
      const price = parsePrice(textOf(priceBox?.querySelector('.a-offscreen') ?? priceBox));
      const upc = readAmazonDetail(doc, /^\s*UPC\s*$/i);
      items.push({
        key: `amazon:${asin}`,
        root: titleEl.closest('#dp-container, #ppd, #dp') ?? doc.body,
        anchor: priceBox?.closest('#corePrice_feature_div, #corePriceDisplay_desktop_feature_div') ?? priceBox ?? titleEl,
        listing: listing({ retailer: 'amazon', retailerProductId: asin, title: textOf(titleEl), price, upc, url: url.href, pageType: 'detail' }),
      });
    }
    return items;
  },
};

function readAmazonDetail(doc: Document, label: RegExp): string | null {
  for (const th of Array.from(doc.querySelectorAll('#productDetails_techSpec_section_1 th, #productDetails_detailBullets_sections1 th, #detailBullets_feature_div .a-text-bold'))) {
    if (label.test(cleanText(th.textContent).replace(/[:‏‎]/g, ''))) {
      const v = cleanText(th.nextElementSibling?.textContent);
      const m = /\b(\d{12,14})\b/.exec(v);
      if (m) return m[1];
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* EB Games Canada (Salesforce Commerce Cloud storefront)              */
/* ------------------------------------------------------------------ */

export const ebGamesAdapter: RetailerAdapter = {
  id: 'ebgames',
  name: 'EB Games Canada',
  hostnames: /(^|\.)ebgames\.ca$/,
  scan(doc, url) {
    const items: DetectedItem[] = [];
    const tiles = Array.from(doc.querySelectorAll('.product-tile[data-pid], [data-pid] .product-tile, .searchProductTile, .product-tile'))
      .map((t) => t.closest('[data-pid]') ?? t)
      .filter((t, i, arr) => arr.indexOf(t) === i);
    for (const tile of tiles) {
      const pid = tile.getAttribute('data-pid');
      const titleEl = first(tile, ['.pdp-link a', '.product-tile-title', '.link.product-name', 'h3 a', 'h2 a', 'a[href*="/products/"]', 'a']);
      const title = textOf(titleEl) || cleanText(tile.querySelector('img')?.getAttribute('alt'));
      if (!title) continue;
      const priceEl = first(tile, ['.price .sales .value', '.price .sales', '.price-sales', '.price']) ?? findPriceElement(tile);
      items.push({
        key: `ebgames:${pid ?? title}`,
        root: tile,
        anchor: priceEl?.closest('.price') ?? priceEl ?? titleEl ?? tile,
        listing: listing({ retailer: 'ebgames', retailerProductId: pid, title, price: priceFrom(priceEl), url: (titleEl as HTMLAnchorElement | null)?.href ?? null, pageType: 'listing' }),
      });
    }
    const detail = doc.querySelector('.product-detail[data-pid], #product-detail, [itemtype*="schema.org/Product"]');
    const ld = readJsonLdProducts(doc)[0];
    const h1 = first(doc, ['h1.product-name', '.product-detail h1', 'h1']);
    if ((detail || ld) && h1 && !tiles.some((t) => t.contains(h1))) {
      const priceEl = first(detail ?? doc, ['.prices .sales .value', '.prices .price .sales', '[itemprop="price"]', '.prices .price']);
      const price: ParsedPrice | null = priceFrom(priceEl) ?? jsonLdPrice(ld);
      if (price || ld) {
        const pid = detail?.getAttribute('data-pid') ?? ld?.sku ?? null;
        items.push({
          key: `ebgames:${pid ?? textOf(h1)}`,
          root: detail ?? h1.parentElement ?? doc.body,
          anchor: priceEl?.closest('.prices') ?? priceEl ?? h1,
          listing: listing({ retailer: 'ebgames', retailerProductId: pid, title: textOf(h1) || ld?.name || '', price, upc: ld?.gtin ?? null, sku: ld?.sku ?? null, description: ld?.description ?? null, url: url.href, pageType: 'detail' }),
        });
      }
    }
    return items;
  },
};

/* ------------------------------------------------------------------ */
/* 401 Games (Shopify storefront)                                      */
/* ------------------------------------------------------------------ */

export const fourOhOneAdapter: RetailerAdapter = {
  id: '401games',
  name: '401 Games',
  hostnames: /(^|\.)401games\.ca$/,
  scan(doc, url) {
    const items: DetectedItem[] = [];
    const isProductPage = /\/products\/[^/]+/.test(url.pathname);
    if (isProductPage) {
      const ld = readJsonLdProducts(doc)[0];
      const h1 = first(doc, ['h1.product__title', 'h1.product-single__title', '.product__title h1', 'h1[itemprop="name"]', 'main h1', 'h1']);
      const priceEl = first(doc, ['.product__info-container .price-item--sale', '.product__info-container .price-item--regular', '[data-product-price]', '.product__price', '.product-single__price', '.price__current', '[itemprop="price"]']);
      const ogPrice = doc.querySelector('meta[property="og:price:amount"]')?.getAttribute('content');
      const price = priceFrom(priceEl) ?? jsonLdPrice(ld) ?? (ogPrice ? parsePrice(`$${ogPrice}`) : null);
      const title = textOf(h1) || ld?.name || '';
      if (title) {
        const handle = /\/products\/([^/?#]+)/.exec(url.pathname)![1];
        items.push({
          key: `401games:${handle}`,
          root: h1?.closest('section, .product, main') ?? doc.body,
          anchor: priceEl?.closest('.price, .price__container, .product__price') ?? priceEl ?? h1 ?? doc.body,
          listing: listing({ retailer: '401games', retailerProductId: handle, title, price, upc: ld?.gtin ?? null, sku: ld?.sku ?? null, description: ld?.description ?? null, url: url.href, pageType: 'detail' }),
        });
      }
    }
    // Collection/search grids — theme-agnostic: product links climbing to the card with a price.
    for (const { root, link } of heuristicCards(doc, 'a[href*="/products/"]')) {
      if (isProductPage && items[0] && root.contains(items[0].anchor)) continue;
      const handle = /\/products\/([^/?#]+)/.exec(link.getAttribute('href') ?? '')?.[1] ?? null;
      const title = textOf(first(root, ['.card__heading', '.product-card__title', '.grid-product__title', '.product-item__title', '.fs-product-title', 'h3', 'h2'])) || cleanText(link.textContent) || cleanText(root.querySelector('img')?.getAttribute('alt'));
      if (!title) continue;
      const priceEl = first(root, ['.price-item--sale', '.price-item--regular', '.price__current', '.product-card__price', '.grid-product__price', '.fs-price', '.price']) ?? findPriceElement(root);
      const key = `401games:${handle ?? title}`;
      if (items.some((i) => i.key === key)) continue;
      items.push({
        key,
        root,
        anchor: priceEl?.closest('.price') ?? priceEl ?? link,
        listing: listing({ retailer: '401games', retailerProductId: handle, title, price: priceFrom(priceEl), url: link.href, pageType: 'listing' }),
      });
    }
    return items;
  },
};
