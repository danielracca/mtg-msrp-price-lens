import { parsePrice } from '../core/price';
import type { ParsedPrice, RetailerListing } from '../core/types';

export interface DetectedItem {
  /** Stable identity of this product on the page (for dedupe and popup). */
  key: string;
  /** The product card / product section. */
  root: Element;
  /** Badge is inserted immediately after this element (usually the price). */
  anchor: Element;
  listing: RetailerListing;
}

export interface RetailerAdapter {
  id: string;
  name: string;
  hostnames: RegExp;
  scan(doc: Document, url: URL): DetectedItem[];
}

export const BADGE_TAG = 'mtg-price-lens-badge';
export const OVERLAY_TAG = 'mtg-price-lens-overlay';

export function cleanText(s: string | null | undefined): string {
  return (s ?? '').replace(/[\s ]+/g, ' ').trim();
}

export function textOf(el: Element | null | undefined): string {
  if (!el) return '';
  // Ignore our own injected nodes.
  const clone = el.cloneNode(true) as Element;
  clone.querySelectorAll(`${BADGE_TAG}, ${OVERLAY_TAG}, script, style`).forEach((n) => n.remove());
  return cleanText(clone.textContent);
}

export function first(root: ParentNode, selectors: string[]): Element | null {
  for (const s of selectors) {
    try {
      const el = root.querySelector(s);
      if (el) return el;
    } catch {
      /* invalid selector in this engine */
    }
  }
  return null;
}

export interface JsonLdProduct {
  name: string | null;
  gtin: string | null;
  sku: string | null;
  description: string | null;
  price: number | null;
  currency: string | null;
  url: string | null;
}

/** Reads schema.org Product data — the most stable structured source on retailer product pages. */
export function readJsonLdProducts(doc: Document): JsonLdProduct[] {
  const out: JsonLdProduct[] = [];
  const visit = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(visit);
    const o = node as Record<string, unknown>;
    if (o['@graph']) visit(o['@graph']);
    const type = o['@type'];
    const isProduct = type === 'Product' || (Array.isArray(type) && type.includes('Product'));
    if (isProduct) {
      const offersRaw = o.offers as Record<string, unknown> | Record<string, unknown>[] | undefined;
      const offer = Array.isArray(offersRaw) ? offersRaw[0] : offersRaw;
      const priceVal = offer?.price ?? offer?.lowPrice ?? (offer?.priceSpecification as Record<string, unknown> | undefined)?.price;
      const gtin = [o.gtin13, o.gtin12, o.gtin14, o.gtin, o.upc, o.gtin8].find((g) => typeof g === 'string' || typeof g === 'number');
      out.push({
        name: typeof o.name === 'string' ? cleanText(o.name) : null,
        gtin: gtin != null ? String(gtin) : null,
        sku: o.sku != null ? String(o.sku) : null,
        description: typeof o.description === 'string' ? o.description.slice(0, 2000) : null,
        price: priceVal != null && Number.isFinite(Number(priceVal)) ? Number(priceVal) : null,
        currency: typeof offer?.priceCurrency === 'string' ? offer.priceCurrency : null,
        url: typeof o.url === 'string' ? o.url : null,
      });
    }
  };
  doc.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
    try {
      visit(JSON.parse(s.textContent ?? ''));
    } catch {
      /* malformed JSON-LD is common; ignore */
    }
  });
  return out;
}

export function jsonLdPrice(p: JsonLdProduct | undefined): ParsedPrice | null {
  if (!p || p.price == null || !(p.price > 0)) return null;
  const currency = p.currency === 'USD' ? 'USD' : 'CAD';
  return { amount: p.price, currency, raw: `${p.price} ${p.currency ?? ''}`.trim() };
}

/** Element whose own text looks like a price, skipping struck-through "was" prices. */
export function findPriceElement(root: Element): Element | null {
  const candidates = Array.from(root.querySelectorAll('span, div, p, strong, b, ins, bdi'))
    .filter((el) => !el.closest('s, del, strike, [class*="compare"], [class*="was"], [class*="strike"], [class*="old-price"], [class*="list-price"]'))
    .filter((el) => !el.closest(BADGE_TAG))
    .filter((el) => /\$\s?\d|\d\s?\$/.test(el.textContent ?? '') && (el.textContent ?? '').length < 60);
  // Deepest first.
  candidates.sort((a, b) => depth(b) - depth(a));
  return candidates[0] ?? null;
}

function depth(el: Element): number {
  let d = 0;
  for (let e: Element | null = el; e; e = e.parentElement) d++;
  return d;
}

/**
 * Generic product-card discovery: start from product links, climb to the smallest
 * ancestor that also contains a price and only one product link target.
 */
export function heuristicCards(doc: Document, linkSelector: string, maxClimb = 8): { root: Element; link: HTMLAnchorElement }[] {
  const seen = new Set<Element>();
  const out: { root: Element; link: HTMLAnchorElement }[] = [];
  const links = Array.from(doc.querySelectorAll<HTMLAnchorElement>(linkSelector));
  for (const link of links) {
    const target = link.getAttribute('href')?.split('?')[0];
    if (!target) continue;
    let el: Element | null = link;
    for (let i = 0; i < maxClimb && el; i++) {
      el = el.parentElement;
      if (!el || el === doc.body) break;
      const targets = new Set(Array.from(el.querySelectorAll<HTMLAnchorElement>(linkSelector)).map((a) => a.getAttribute('href')?.split('?')[0]));
      if (targets.size > 1) break;
      if (/\$\s?\d|\d\s?\$/.test(el.textContent ?? '')) {
        if (!seen.has(el)) {
          seen.add(el);
          out.push({ root: el, link });
        }
        break;
      }
    }
  }
  return out;
}

export function listing(partial: Partial<RetailerListing> & Pick<RetailerListing, 'retailer' | 'title' | 'pageType'>): RetailerListing {
  return { retailerProductId: null, price: null, upc: null, sku: null, description: null, url: null, ...partial };
}

export function priceFrom(el: Element | null): ParsedPrice | null {
  if (!el) return null;
  const content = el.getAttribute('content');
  if (content && /^\d+(\.\d+)?$/.test(content)) return { amount: Number(content), currency: 'CAD', raw: content };
  return parsePrice(textOf(el));
}
