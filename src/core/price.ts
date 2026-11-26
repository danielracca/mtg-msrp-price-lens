import type { ParsedPrice } from './types';

/**
 * Parses retailer price strings, e.g.
 *   "$49.97", "current price $44.96", "Now $44.96 Was $59.99", "49,97 $", "CDN$ 54.99", "$1,299.00"
 * Returns null for ranges ("$10.00 - $20.00"), unit prices only, or unparseable text.
 */
export function parsePrice(raw: string | null | undefined, defaultCurrency: 'CAD' | 'USD' = 'CAD'): ParsedPrice | null {
  if (!raw) return null;
  let text = raw.replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return null;

  // Strip "was/reg/list" reference prices — we want the current selling price.
  text = text.replace(/\b(?:was|reg(?:ular)?(?:\s+price)?|list(?:\s+price)?|typical(?:\s+price)?|msrp|avant|prix courant)\b\s*:?\s*(?:CDN\$|C\$|CA\$|US\$|USD|CAD|\$)?\s*\d[\d.,\s]*\$?/gi, ' ');
  // Strip per-unit prices: "$1.50/ea", "12.3 ¢/ea".
  text = text.replace(/(?:\$\s?)?\d[\d.,]*\s*(?:¢|\$)?\s*\/\s*(?:ea|each|unit|ct|count|100\s?g)\b/gi, ' ');

  const currency: 'CAD' | 'USD' = /\b(?:US\$|USD)\b|US\s?\$/i.test(text) ? 'USD' : /\b(?:CDN|CAD|CA\$|C\$)/i.test(text) ? 'CAD' : defaultCurrency;

  const pattern = /(?:CDN\$|C\$|CA\$|US\$|\$)\s?(\d{1,3}(?:[ ,]\d{3})*(?:[.,]\d{2})?|\d+(?:[.,]\d{2})?)|(\d{1,3}(?:[  .]\d{3})*(?:,\d{2})|\d+(?:[.,]\d{2})?)\s?\$/g;
  const amounts: number[] = [];
  for (const m of text.matchAll(pattern)) {
    const n = m[1] !== undefined ? normalizeNumber(m[1], 'en') : normalizeNumber(m[2], 'fr');
    if (n !== null) amounts.push(n);
  }
  if (amounts.length === 0) {
    // Bare number with currency code, e.g. "CAD 54.99" or JSON-LD "54.99".
    const bare = /^(?:CAD|USD)?\s*(\d+(?:\.\d{1,2})?)\s*(?:CAD|USD)?$/i.exec(text);
    if (bare) amounts.push(Number(bare[1]));
  }
  if (amounts.length === 0) return null;

  // A range ("$10.00 - $20.00" / "$10 to $20") is not a single selling price.
  if (amounts.length >= 2 && /\d\s*(?:-|–|to|à)\s*(?:CDN\$|C\$|US\$|\$)?\s*\d/i.test(text)) return null;

  const amount = amounts[0];
  if (!(amount > 0) || amount > 100000) return null;
  return { amount: Math.round(amount * 100) / 100, currency, raw };
}

function normalizeNumber(s: string, locale: 'en' | 'fr'): number | null {
  let t = s.trim();
  if (locale === 'fr') {
    t = t.replace(/[  .]/g, '').replace(',', '.');
  } else {
    // "1,299.00" → 1299.00 ; "54,99" (comma decimal after $) → 54.99
    if (/^\d+,\d{2}$/.test(t)) t = t.replace(',', '.');
    else t = t.replace(/[ ,]/g, '');
  }
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Walmart and others split the price across elements: "$" "44" "96" → "$44.96". */
export function parseSplitPrice(dollars: string, cents: string | null): number | null {
  const d = Number(dollars.replace(/[^\d]/g, ''));
  const c = cents ? Number(cents.replace(/[^\d]/g, '').padEnd(2, '0').slice(0, 2)) : 0;
  if (!Number.isFinite(d) || !Number.isFinite(c)) return null;
  return d + c / 100;
}
