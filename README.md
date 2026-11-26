# MTG Price Lens

A Chrome extension (Manifest V3) for Canadian Magic: The Gathering collectors. It shows, right under a sealed product's price, how that price compares with Wizards of the Coast's **official MSRP** converted to CAD.

```
$49.94
▼ 20% below MSRP      ← click for details, official source, exchange rate, match confidence
```

Supported stores: **Walmart Canada** (primary), Amazon.ca, EB Games Canada, 401 Games. It works on search/listing pages and product pages, including infinite scroll and in-page (SPA) navigation.

> ⚠️ **Live-site status:** Walmart.ca blocked automated access from the development environment (HTTP 307/456 bot protection), so the extension has been verified **only against local fixtures that reproduce Walmart's markup**, not against the live site. See [Verifying on live Walmart.ca](#verifying-on-live-walmartca). The same applies to Amazon.ca, EB Games and 401 Games.

---

## Install (unpacked)

Requirements: Node.js 20+ and Chrome or another Chromium browser.

```bash
npm install
```

```bash
npm run build
```

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and select `.output/chrome-mv3`.
3. Visit <https://www.walmart.ca/en/search?q=magic+the+gathering>.

For development with hot reload, run `npm run dev`. It opens a browser with the extension loaded.

## Install in Safari (macOS)

Safari needs the extension wrapped in a small Mac app built with Xcode, so these steps run on a Mac with Xcode installed.

1. Build the Safari version. It lands in `.output/safari-mv3`:

   ```bash
   npm run build:safari
   ```

2. Convert it to an Xcode project (opens Xcode):

   ```bash
   xcrun safari-web-extension-converter .output/safari-mv3 --app-name "MTG Price Lens" --macos-only
   ```

3. In Xcode press ▶ (Product → Run). If asked, pick your Apple ID under *Signing & Capabilities → Team*; a free personal team works.
4. In Safari: Settings → Advanced → tick **Show features for web developers**. Then Settings → Developer → tick **Allow unsigned extensions** (Safari clears this every time it quits). Then Settings → Extensions → enable **MTG Price Lens**.
5. On walmart.ca (and each other store), click the extension icon and choose **Always Allow on This Website**.

After code changes, rerun step 1 and press ▶ again. The Safari build has been compiled but not yet tested in Safari.

## What you see

| Badge | Meaning |
|---|---|
| **▼ 24% below MSRP** (dark green) | ≥ 20% below MSRP |
| **▼ 10% below MSRP** (green) | 5%–19.99% below |
| **● At MSRP** (grey) | within ±5% |
| **▲ 12% above MSRP** (orange) | 5%–19.99% above |
| **▲ 35% above MSRP** (red) | ≥ 20% above |
| **▼ 19% below est. benchmark** (dashed) | No official MSRP; compared with an *estimated benchmark* such as 30 × Play Booster MSRP for a booster box |
| **○ MSRP unavailable** | Wizards published no MSRP (e.g. Prerelease Packs, sets before Foundations) |
| **? Product match uncertain** | The engine isn't sure which product this is, so no comparison is shown. Click to pick the product; your choice is remembered on this device |

Every badge uses an icon and words as well as colour, so it doesn't rely on colour alone. Badges live in a Shadow DOM, so retailer CSS can't change them. Thresholds are configurable.

The **popover** shows: the identified product, set and type, retailer price, official USD MSRP, Estimated CAD MSRP, % and $ difference, exchange rate and its date, match confidence, and a link to the official Wizards source.

The **popup** shows counts (detected / below / above / no MSRP / uncertain), the best *verified* deal (official MSRP and confident match only), a list you can sort by % below MSRP, the exchange rate, and the database version. Its **Settings** tab covers: badges on/off, minimum discount, show only below-MSRP, show/hide estimated benchmarks, display currency (CAD or CAD + USD), custom exchange rate, refresh database, refresh rate, thresholds, and an optional remote database URL.

### How prices are compared

```
Estimated CAD MSRP    = Official USD MSRP × USD→CAD rate
Percentage difference = (Retailer CAD price − Estimated CAD MSRP) / Estimated CAD MSRP × 100
```

- Only the listed, pre-tax **item price** is used. Shipping and tax are never added. Struck-through "was" prices are ignored.
- Wizards publishes MSRPs in USD only, so the CAD figure is always called an **Estimated CAD MSRP**. If Wizards ever publishes a CAD MSRP (`msrp.cad`), it is used instead.
- The rate comes from the **Bank of Canada** (free, official). It is cached, refreshed about every 24 h, and falls back to the last good rate when the service is down. A stale rate is flagged in the popover and popup. You can also set your own rate.
- Benchmarks are kept separate everywhere. Booster boxes have **no official MSRP**, so they show *"Combined pack MSRP — estimated benchmark"*, never "MSRP". Multi-unit listings ("set of 5 decks") are also benchmarks.

## The MSRP database

`data/products.json` is bundled with the extension, so no backend is needed. It holds **201 records across 16 sets**, Foundations → Nauctis: The Sunken Realm. Every official price comes from an official Wizards of the Coast article. The research and sources are in [docs/RESEARCH.md](docs/RESEARCH.md).

Each record has: id, canonical name, aliases, set name and code, category, variant, edition, release date, UPCs, pack count, an `msrp` block, last-verified date, and verification status. The `msrp` block holds:

- `classification`: `official` | `derived` | `unavailable`
- `usd` and `cad`
- `derivation`
- source URL, title and publication date
- the original source line

Nothing is invented. Products without an official MSRP are marked `unavailable`, and benchmarks are `derived` with a recorded formula. Third-party prices (TCGplayer, MTGCompare, retailers) are never used.

### Maintaining it (command-line)

The CLI is the **only** component that contacts Wizards. The extension never scrapes. The CLI checks `robots.txt`, sends an identifying User-Agent, waits 1.5 s between requests, and caches pages in `data/.cache/`.

Fetch the official sources and write a dry-run report to `data/review-report.md`:

```bash
npm run db:refresh
```

Rebuild from cached pages without touching the network:

```bash
npm run db:refresh -- --offline
```

Write `data/products.json` (refused if the report has errors):

```bash
npm run db:refresh -- --write
```

Check the schema, duplicates, and classification rules:

```bash
npm run db:validate
```

List official "Collecting …" articles that aren't registered yet:

```bash
npm run db:discover
```

The refresh **report** lists new, changed and removed products. It also flags anything for manual review:

- unrecognized product labels
- prices that conflict across sources (e.g. the announcement vs the collecting article)
- deck names or release dates not found in the source text
- missing pack counts

Curated fields such as UPCs and extra aliases survive a rebuild.

**Adding a new set:**

1. Run `npm run db:discover`, or find the set's *Collecting …* article on magic.wizards.com.
2. Add an entry to `scripts/db/sources.json` with the code, name, aliases, release date (plus the exact `releaseDateText` used for cross-checking), any variant lists the article doesn't list under "Commander Decks", and `reviewedLabels` for new product types.
3. Run `npm run db:refresh`, read `data/review-report.md`, resolve the flags, then run `npm run db:refresh -- --write`.
4. Run `npm test`, then `npm run build`, and reload the extension.

**Updating without rebuilding the extension:** host the generated `products.json` anywhere over HTTPS. Then enter its URL under *Settings → Remote database* and click *Refresh product database*. It is validated before use, and a newer `dbVersion` replaces the bundled copy. To add UPCs, append them to a product's `upc` array; they are preserved across refreshes.

## Matching engine

`src/core/matching/` resolves a listing in this order:

1. Manual correction
2. UPC/GTIN
3. Deterministic rules
   - Exclusions: singles, sleeves, playmats, proxies, empty boxes, graded cards, other merchandise, and other games.
   - Product type, in an order that handles tricky titles: a bundle's "9 Play Boosters" doesn't make it a booster, and a Commander deck's "Collector Booster Sample Pack" doesn't make it a Collector Booster.
   - Set name and aliases.
   - Named variants. These pin the set, so "Foundations Commander Deck – Reign of Dragons" maps to Reality Fracture.
   - Edition: Collector's, Premium or Game Edition.
   - Quantity and pack count.
4. Fuzzy similarity, which only nudges the confidence score.

Below 75% confidence, or whenever there's real ambiguity, the badge says **Product match uncertain** instead of showing a possibly wrong comparison.

Hard cases with tests:

- boosters vs boxes
- Gift Bundle vs Bundle (a Gift Bundle for a set that has none never falls back to a regular Bundle)
- Collector vs Play Boosters
- different decks of one set
- single decks vs sets of decks
- Scene Box vs case
- standard vs Collector's/Premium editions

## Architecture

```
entrypoints/
  background.ts      Service worker: Bank of Canada rate (cache/refresh/fallback), DB refresh
  content.ts         Picks the retailer adapter, starts the PageController
  popup/             React popup (summary, sorting, settings)
src/
  adapters/          One adapter per retailer (+ shared JSON-LD / heuristics helpers)
  content/           PageController (scan, MutationObserver, dedupe, SPA), badge (Shadow DOM), Popover (React)
  core/              types, price parsing, fx, msrp math, matching, validation, ingestion
  shared/            storage, messages, formatting
data/products.json   Bundled MSRP database
scripts/db/          Database CLI + verified source registry
tests/               Unit tests (vitest + jsdom), fixtures, Chromium e2e
```

Permissions are minimal: `storage`, `alarms`, and host access only to `bankofcanada.ca/valet`. A remote database host is requested at runtime, only if you configure one. There are no accounts, analytics, AI services or backend.

### Adding a retailer

1. Create an adapter implementing `RetailerAdapter` (`src/adapters/common.ts`). `scan(document, url)` returns items with `key`, `root` (the card), `anchor` (the badge goes right after it, usually the price) and `listing` (title, price, IDs, UPC). Prefer, in order: stable data attributes, then JSON-LD and `itemprop` markup, then `heuristicCards()`.
2. Register it in `src/adapters/registry.ts` and add the host to `matches` in `entrypoints/content.ts`.
3. Add a saved HTML fixture in `tests/fixtures/` and tests in `tests/unit/adapters.test.ts`.

## Testing

Unit tests (124 tests):

```bash
npm test
```

They cover price parsing, MSRP/FX math, thresholds, stale rates, matching, variants, multi-unit listings, missing MSRP, ambiguous matches, adapters, duplicate injection, dynamic cards, SPA navigation, settings, manual corrections and the popover.

Type-check:

```bash
npm run compile
```

End-to-end test (builds first). It loads the extension into Chromium and serves the fixtures at real retailer URLs through request interception, so the live site is never hit. It also fetches the live Bank of Canada rate. Screenshots go to `tests/e2e/screenshots/`.

```bash
npm run test:e2e
```

The e2e test needs Playwright with Chromium. It uses `require('playwright')` and falls back to the global install.

Regenerate the Walmart fixtures:

```bash
node tests/fixtures/gen-walmart.mjs
```

### Verifying on live Walmart.ca

These steps are needed before calling Walmart support production-ready:

1. Load the unpacked extension in your normal Chrome and search for "Magic the Gathering" on walmart.ca.
2. Check that badges sit under the prices, that the popover opens, and that scrolling or the next page adds badges.
3. If no badges appear, open DevTools on a product tile and compare its attributes with `TITLE_SELECTORS` / `PRICE_SELECTORS` in `src/adapters/walmart.ts`.
4. Save a copy of the page (`Ctrl+S`, "HTML only") into `tests/fixtures/`, add a test, and adjust the adapter.

## Known limitations

- Not yet verified on the live retailer sites (see above). Retailer markup changes over time.
- Retailer titles that omit the set or deck name are shown as uncertain until you pick the product.
- UPCs aren't published by Wizards, so the database starts with none. Add them as you confirm them.
- Foundations and Innistrad Remastered box pack counts aren't in the official source, so those boxes get a benchmark only when the listing states a pack count.
- Safari: a Safari build is produced (`npm run build:safari`) but has only been run in Chrome so far. Safari may handle the optional remote-database permission request differently.
