import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { amazonAdapter, ebGamesAdapter, fourOhOneAdapter } from '../../src/adapters/others';
import { adapterFor } from '../../src/adapters/registry';
import { walmartAdapter } from '../../src/adapters/walmart';

const fixture = (name: string) => new DOMParser().parseFromString(readFileSync(join(__dirname, '../fixtures', name), 'utf8'), 'text/html');

describe('adapter registry', () => {
  it('routes hosts to adapters', () => {
    expect(adapterFor('www.walmart.ca')?.id).toBe('walmart');
    expect(adapterFor('www.amazon.ca')?.id).toBe('amazon');
    expect(adapterFor('www.ebgames.ca')?.id).toBe('ebgames');
    expect(adapterFor('store.401games.ca')?.id).toBe('401games');
    expect(adapterFor('www.walmart.com')).toBeNull();
  });
});

describe('Walmart Canada adapter', () => {
  it('extracts tiles from the search page', () => {
    const items = walmartAdapter.scan(fixture('walmart-search.html'), new URL('https://www.walmart.ca/en/search?q=magic+the+gathering'));
    expect(items).toHaveLength(12);
    const first = items[0];
    expect(first.listing.retailerProductId).toBe('6000209010001');
    expect(first.listing.title).toBe('Magic: The Gathering Foundations Play Booster');
    expect(first.listing.price?.amount).toBe(6.47);
    expect(first.anchor.getAttribute('data-automation-id')).toBe('product-price');
  });
  it('reads current price, not the struck-through "was" price', () => {
    const items = walmartAdapter.scan(fixture('walmart-search.html'), new URL('https://www.walmart.ca/en/search?q=x'));
    expect(items.find((i) => i.listing.retailerProductId === '6000209010003')?.listing.price?.amount).toBe(184.97);
  });
  it('handles prices split into dollar/cent spans', () => {
    const items = walmartAdapter.scan(fixture('walmart-search.html'), new URL('https://www.walmart.ca/en/search?q=x'));
    expect(items.find((i) => i.listing.retailerProductId === '6000209010002')?.listing.price?.amount).toBe(59.97);
  });
  it('extracts product page title, price and UPC (JSON-LD), plus carousel tiles', () => {
    const url = new URL('https://www.walmart.ca/en/ip/magic-the-gathering-tarkir-dragonstorm-play-booster-box/6000209030001');
    const items = walmartAdapter.scan(fixture('walmart-product.html'), url);
    const d = items[0];
    expect(d.listing.pageType).toBe('detail');
    expect(d.listing.price?.amount).toBe(159.97);
    expect(d.listing.upc).toBe('0195166281234');
    expect(d.listing.retailerProductId).toBe('6000209030001');
    expect(items[1].listing.title).toBe('Magic: The Gathering Tarkir: Dragonstorm Bundle');
  });
  it('falls back to heuristics if tile hooks disappear', () => {
    const doc = fixture('walmart-search.html');
    doc.querySelectorAll('[data-item-id]').forEach((t) => t.removeAttribute('data-item-id'));
    const items = walmartAdapter.scan(doc, new URL('https://www.walmart.ca/en/search?q=x'));
    expect(items.length).toBeGreaterThanOrEqual(10);
    expect(items[0].listing.price?.amount).toBe(6.47);
  });
});

describe('Amazon.ca adapter', () => {
  it('search results', () => {
    const items = amazonAdapter.scan(fixture('amazon-search.html'), new URL('https://www.amazon.ca/s?k=mtg'));
    expect(items).toHaveLength(3);
    expect(items[0].listing.title).toBe('Magic: The Gathering Foundations Collector Booster');
    expect(items[0].listing.price?.amount).toBe(29.99);
    expect(items[1].listing.price?.amount).toBe(289.99);
  });
  it('product page', () => {
    const items = amazonAdapter.scan(fixture('amazon-product.html'), new URL('https://www.amazon.ca/dp/B0DDFT0009'));
    expect(items[0].listing.retailerProductId).toBe('B0DDFT0009');
    expect(items[0].listing.price?.amount).toBe(64.99);
    expect(items[0].listing.upc).toBe('195166270009');
  });
});

describe('EB Games adapter', () => {
  it('search tiles with sale price', () => {
    const items = ebGamesAdapter.scan(fixture('ebgames-search.html'), new URL('https://www.ebgames.ca/en/search?q=magic'));
    expect(items).toHaveLength(2);
    expect(items[0].listing.title).toBe('Magic: The Gathering Edge of Eternities Bundle');
    expect(items[0].listing.price?.amount).toBe(69.99);
  });
});

describe('401 Games adapter', () => {
  it('collection grid uses sale price', () => {
    const items = fourOhOneAdapter.scan(fixture('401games-collection.html'), new URL('https://store.401games.ca/collections/mtg-sealed'));
    expect(items).toHaveLength(2);
    expect(items[0].listing.price?.amount).toBe(449.99);
    expect(items[1].listing.price?.amount).toBe(54.99);
  });
  it('product page + related products', () => {
    const items = fourOhOneAdapter.scan(fixture('401games-product.html'), new URL('https://store.401games.ca/products/mtg-lorwyn-eclipsed-bundle'));
    expect(items[0].listing.pageType).toBe('detail');
    expect(items[0].listing.price?.amount).toBe(79.99);
    expect(items[0].listing.upc).toBe('195166299990');
    expect(items.some((i) => i.listing.title === 'MTG - Lorwyn Eclipsed - Play Booster')).toBe(true);
  });
});
