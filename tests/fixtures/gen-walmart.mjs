// Generates synthetic Walmart.ca fixtures that mirror the storefront's markup hooks
// (data-item-id tiles, data-automation-id title/price, screen-reader "current price" text,
// split dollar/cent spans, strike-through "was" prices). Prices are fictional test data.
// Run: node tests/fixtures/gen-walmart.mjs
import { writeFileSync } from 'node:fs';

const tile = (id, title, price, opts = {}) => {
  const [d, c] = price.toFixed(2).split('.');
  const was = opts.was ? `<div class="gray mr1 strike f7 f6-l">$${opts.was.toFixed(2)}</div>` : '';
  const now = opts.was ? 'Now ' : '';
  const priceHtml = opts.split
    ? `<div class="mr1 mr2-xl b black lh-copy f5 f4-l" aria-hidden="true"><span class="f6 f5-l" style="vertical-align:0.65ex;margin-right:2px">$</span><span class="f2">${d}</span><span class="f6 f5-l" style="vertical-align:0.75ex">${c}</span></div>`
    : `<div class="mr1 mr2-xl b black lh-copy f5 f4-l" aria-hidden="true">${now}$${price.toFixed(2)}</div>`;
  return `
  <div role="group" data-item-id="${id}" class="mb0 ph0-xl pt0-xl bb b--near-white w-25 pb3-m ph1">
    <div class="h-100 pb1-xl pr4-xl pv1 ph1"><div class="h-100 relative">
      <a link-identifier="${id}" class="w-100 h-100 z-1 hide-sibling-opacity absolute" href="/en/ip/${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}/${id}"><span class="w_iUH7">${title}</span></a>
      <div class="relative overflow-hidden"><img loading="eager" class="thumb" alt="${title.replace(/"/g, '&quot;')}" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></div>
      <div data-testid="list-view" class="">
        <div data-automation-id="product-price" class="flex flex-wrap justify-start items-center lh-title mb1">
          ${priceHtml}
          <span class="w_iUH7">current price ${now}$${price.toFixed(2)}${opts.was ? `, Was $${opts.was.toFixed(2)}` : ''}</span>
          ${was}
        </div>
        <span data-automation-id="product-title" class="normal dark-gray mb0 mt1 lh-title f6 f5-l lh-copy">${title}</span>
        <div class="flex items-center mt2"><span class="w_iUH7">4.8 out of 5 Stars. 120 reviews</span></div>
        <div class="mt2 mb2"><span class="f7 mr1 blue b lh-copy">Free shipping, arrives in 3+ days</span></div>
      </div>
    </div></div>
  </div>`;
};

export const page1 = [
  ['6000209010001', 'Magic: The Gathering Foundations Play Booster', 6.47, {}],
  ['6000209010002', 'Magic: The Gathering Foundations Bundle - 9 Play Boosters, 30 Land Cards + Exclusive Accessories', 59.97, { split: true }],
  ['6000209010003', 'Magic: The Gathering Edge of Eternities Play Booster Box - 30 Packs', 184.97, { was: 219.99 }],
  ['6000209010004', 'Magic: The Gathering Edge of Eternities Commander Deck - World Shaper (100-Card Deck, 2-Card Collector Booster Sample Pack + Accessories)', 49.94, {}],
  ['6000209010005', 'Magic: The Gathering FINAL FANTASY Gift Bundle', 179.99, {}],
  ['6000209010006', "Magic: The Gathering Marvel's Spider-Man Bundle", 99.47, { split: true }],
  ['6000209010007', 'Magic: The Gathering Tarkir: Dragonstorm Collector Booster', 34.97, {}],
  ['6000209010008', 'Magic: The Gathering Duskmourn: House of Horror Play Booster Box', 169.99, {}],
  ['6000209010009', 'Ultra Pro Magic: The Gathering Foundations Deck Protector Sleeves (100ct)', 14.97, {}],
  ['6000209010010', 'Magic: The Gathering Reality Fracture Commander Deck', 49.99, {}],
  ['6000209010011', 'Pokemon TCG Scarlet & Violet Booster Bundle', 39.97, {}],
  ['6000209010012', 'Magic: The Gathering Lorwyn Eclipsed Commander Deck - Blight Curse', 71.49, {}],
];
export const page1More = [
  ['6000209010013', 'Magic: The Gathering Avatar: The Last Airbender Collector Booster', 54.97, {}],
  ['6000209010014', 'Magic: The Gathering Teenage Mutant Ninja Turtles Pizza Bundle', 139.96, {}],
  ['6000209010015', 'Magic: The Gathering Secrets of Strixhaven Play Booster - 3 Packs', 23.47, {}],
  ['6000209010016', 'Magic: The Gathering Sol Ring Single Card Near Mint', 4.99, {}],
];
export const page2 = [
  ['6000209020001', 'Magic: The Gathering Star Trek Commander Deck - Klingon Fury', 106.97, {}],
  ['6000209020002', 'Magic: The Gathering The Hobbit Scene Box', 59.97, {}],
];

const render = (rows) => rows.map((r) => tile(...r)).join('\n');

const shell = (body, extraScript = '') => `<!doctype html>
<html lang="en-CA"><head><meta charset="utf-8"><title>magic the gathering - Walmart.ca</title>
<style>body{font-family:Arial,sans-serif;margin:0} .w_iUH7{position:absolute!important;width:1px;height:1px;overflow:hidden;clip:rect(1px,1px,1px,1px)} [data-item-id]{display:inline-block;vertical-align:top;width:24%;min-height:340px;box-sizing:border-box;padding:8px} .relative{position:relative} .absolute{position:absolute} .thumb{width:100%;height:140px;background:#eee;display:block} .strike{text-decoration:line-through} .f2{font-size:24px} #sentinel{height:40px}
/* Hostile retailer CSS that must not leak into the badge (Shadow DOM isolation test). */ button{background:hotpink!important;font-size:30px!important} span{letter-spacing:3px}</style>
</head><body>
<header><h1 class="f3">Results for "magic the gathering"</h1></header>
<main><section><div data-testid="item-stack" id="grid" class="flex flex-wrap w-100">
${body}
</div><div id="sentinel"></div>
<nav aria-label="pagination"><a id="next" href="/en/search?q=magic+the+gathering&amp;page=2">Next page</a></nav></section></main>
<script>${extraScript}</script>
</body></html>`;

// Infinite scroll + Next.js-style SPA pagination are simulated by page scripts.
const scripts = `
const more = ${JSON.stringify(render(page1More))};
const p2 = ${JSON.stringify(render(page2))};
let loaded = false;
function loadMore(){ if(loaded) return; loaded = true; setTimeout(function(){ document.getElementById('grid').insertAdjacentHTML('beforeend', more); }, 150); }
new IntersectionObserver(function(e){ if(e[0].isIntersecting) loadMore(); }).observe(document.getElementById('sentinel'));
window.__loadMore = loadMore;
// React-style re-render: replace the first tile with a fresh copy of its original markup.
const firstHtml = document.querySelector('[data-item-id]').outerHTML;
window.__rerenderFirst = function(){ const t = document.querySelector('[data-item-id]'); const c = document.createElement('div'); c.innerHTML = firstHtml; t.replaceWith(c.firstElementChild); };
document.getElementById('next').addEventListener('click', function(e){ e.preventDefault(); history.pushState({}, '', '/en/search?q=magic+the+gathering&page=2'); document.getElementById('grid').innerHTML = p2; });
`;

writeFileSync(new URL('./walmart-search.html', import.meta.url), shell(render(page1), scripts));

const ld = {
  '@context': 'https://schema.org',
  '@type': 'Product',
  name: 'Magic: The Gathering Tarkir: Dragonstorm Play Booster Box | 30 Packs (420 Magic Cards)',
  sku: '6000209030001',
  gtin13: '0195166281234',
  description: 'Each box contains 30 Play Boosters.',
  offers: { '@type': 'Offer', price: 159.97, priceCurrency: 'CAD', availability: 'https://schema.org/InStock' },
};
writeFileSync(
  new URL('./walmart-product.html', import.meta.url),
  `<!doctype html>
<html lang="en-CA"><head><meta charset="utf-8"><title>${ld.name} | Walmart Canada</title>
<script type="application/ld+json">${JSON.stringify(ld)}</script></head><body>
<main><section data-testid="product-details">
<h1 id="main-title" itemprop="name" class="b mh0 mv1 lh-copy f4 f3-m">${ld.name}</h1>
<div class="flex items-baseline"><div data-testid="price-wrap" class="mr3"><span itemprop="price" data-seo-id="hero-price" aria-hidden="false">Now $159.97</span><span class="gray strike ml2">$199.99</span></div></div>
<button>Add to cart</button>
<section><h2>Specifications</h2><div><h3>Universal Product Code (UPC check)</h3><div>195166281234</div></div></section>
</section>
<section aria-label="Similar items"><h2>Similar items you might like</h2>
${tile('6000209030002', 'Magic: The Gathering Tarkir: Dragonstorm Bundle', 67.97, {})}
</section></main></body></html>`,
);
console.log('Walmart fixtures written');
