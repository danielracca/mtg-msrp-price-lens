# Research, risks and implementation plan

Research done on 2026-11-26, before implementation.

## 1. Official MTG MSRP data

**Finding:** Wizards of the Coast stopped publishing MSRPs for several years. It resumed with *Foundations*, per the announcement [“Magic Returns to Listing MSRP with Foundations”](https://magic.wizards.com/en/news/announcements/magic-returns-to-listing-msrp-with-foundations) (Oct 25, 2024). Key points from that page:

- MSRPs are listed **in US dollars only**, and **only for certain products**: “typically … individual Play Boosters, Collector Boosters, Bundles, and Commander decks.”
- *Foundations* is deliberately priced lower ($5.25 Play Booster) as an on-ramp.
- Aetherdrift's prices match what Bloomburrow and Duskmourn *would have had*. This is stated as a hypothetical, so those sets still have **no** official MSRP. The extension treats them as “MSRP unavailable.”

Since then, each set's official **“Collecting <Set>”** article on magic.wizards.com has an `MSRPs` section. It uses a regular `Label: $xx.xx` format, for example “Play Booster: $5.49” or “Commander Deck: $44.99”. These articles are the primary source. Verified sources:

| Set | Code | Release | Source article |
|---|---|---|---|
| Foundations | FDN | 2024‑11‑15 | MSRP announcement (+ collecting article for release info) |
| Innistrad Remastered | INR | 2025‑01‑24 | MSRP announcement |
| Aetherdrift | DFT | 2025‑02‑14 | collecting-aetherdrift (cross-checked against the announcement) |
| Tarkir: Dragonstorm | TDM | 2025‑04‑11 | collecting-tarkir-dragonstorm |
| FINAL FANTASY | FIN | 2025‑06‑13 | collecting-final-fantasy |
| Edge of Eternities | EOE | 2025‑08‑01 | collecting-edge-of-eternities |
| Marvel's Spider-Man | SPM | 2025‑09‑26 | collecting-marvels-spider-man |
| Avatar: The Last Airbender | TLA | 2025‑11‑21 | collecting-avatar-the-last-airbender |
| Lorwyn Eclipsed | ECL | 2026‑01‑23 | collecting-lorwyn-eclipsed |
| Teenage Mutant Ninja Turtles | TMT | 2026‑03‑06 | collecting-teenage-mutant-ninja-turtles |
| Secrets of Strixhaven | SOS | 2026‑04‑24 | collecting-secrets-of-strixhaven |
| Marvel Super Heroes | MSH | 2026‑06‑26 | collecting-marvel-super-heroes |
| The Hobbit | HOB | 2026‑08‑14 | collecting-the-hobbit |
| Reality Fracture | FRA | 2026‑10‑02 | collecting-reality-fracture |
| Star Trek | TRK | 2026‑11‑13 | collecting-star-trek |
| Nauctis: The Sunken Realm | NAU | 2027‑02‑05 | collecting-nauctis-the-sunken-realm (preorder) |

Set codes come from Wizards' own asset file names (for example `0202_MTGFIN_…`). They are used only as weak matching hints.

**Observations that shaped the data model**

- **No official booster box MSRP exists** for any of these sets. The articles do state “Play Booster box includes 30 Play Boosters” and “Collector Booster box includes 12.” Box records are therefore stored as `derived` with `30 × pack MSRP`, labelled *“Combined pack MSRP — estimated benchmark”*. For Foundations and Innistrad Remastered the pack count is not stated in the source, so the box is `unavailable`. A benchmark is derived only if the retailer listing states a pack count.
- **Prerelease Packs** are mentioned but never priced. They are stored as `unavailable`.
- Prices changed in 2026: from *Lorwyn Eclipsed*, Collector Boosters went to $26.99 and Commander decks to $49.99. The source marks these with an asterisk, which is kept in the record as a note.
- Universes Beyond sets use a separate price tier (for example a $69.99–$74.99 Commander deck and a $149.99–$159.99 Collector's Edition).
- *Reality Fracture* sells two kinds of Commander deck at different MSRPs: “Foundations” decks at $29.99 and the Multiverse Reforged deck at $49.99. An unnamed “Reality Fracture Commander Deck” therefore cannot be priced, and the engine marks it uncertain.
- **No CAD MSRP is published anywhere.** The `cad` field exists but is empty in every record, so all CAD values are labelled “Estimated CAD MSRP.”
- No source publishes UPCs. The `upc` arrays start empty and can be filled by maintainers.
- TCGplayer, MTGCompare, and retailer prices were **not** used as MSRP.

## 2. Walmart Canada page structure

**Live access limitation (important):** From the development environment, `www.walmart.ca` returned `307 "blocked - redirecting"` to plain HTTP clients and HTTP 456 (bot protection) to headless Chromium. Bot protection was **not** circumvented. As a result, **live Walmart.ca compatibility has not been verified.**

The adapter targets the markup used by Walmart's shared Next.js storefront, which walmart.ca also uses:

- `[data-item-id]` product tiles; `data-automation-id="product-title"` / `"product-price"` hooks. These are test-automation attributes and much more stable than the hashed `w_xxxx` class names.
- A screen-reader span reading `current price $44.96` (or `current price Now $44.96, Was $59.99`) next to a split visual price (`$` `44` `96`).
- Product pages: `/en/ip/<slug>/<ITEMID>`, `h1#main-title`, `[itemprop=price]`/`data-seo-id="hero-price"`, and a schema.org JSON-LD `Product` with `gtin13` and `offers.price`.
- A heuristic fallback (product links → card with a price) in case the automation hooks change.

The local fixtures in `tests/fixtures/` reproduce this structure. **Validate on a real browser before relying on it.** See the README section “Verifying on live Walmart.ca.”

## 3. Matching strategy

Strategies, from most to least reliable:

1. **Manual correction** (stored per retailer product ID).
2. **UPC/GTIN** (normalized for GTIN‑13/UPC‑A).
3. **Rules engine:** detect the sealed product type in a fixed precedence order (bundles and decks *before* boosters, because their titles mention “Play Boosters” or “Collector Booster Sample Pack”). Then detect the set by name or alias, the edition (Collector's / Premium / Game), and named variants (deck names, specialty bundles), which also pin the set. Finally detect quantity (“set of 5”, “3 packs”, “case of 6”).
4. **Fuzzy similarity** (Dice bigrams) only nudges confidence. It never chooses a product.

The match is marked uncertain (and no comparison is shown) when there are two sets, two variants, a type or edition missing for the set, an unnamed variant whose siblings have different MSRPs, a “case/carton” without a count, or a pack count that contradicts the official one.

## 4. Exchange rate

[Bank of Canada Valet API](https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json?recent=1). It is free, keyless, and official, and was verified working (2026‑11‑25: 1.4219). It publishes business days only, so a rate is called stale after 4 days. It is cached in `chrome.storage`, refreshed at most every 24 h (alarm every 6 h checks age), and the last good rate is kept on failure. The user can set a custom rate.

## 5. Risks and assumptions

| Risk | Mitigation |
|---|---|
| Walmart markup or bot protection changes | Multiple strategies (automation hooks → JSON-LD → heuristics); fixtures make regressions testable; not live-verified (see above) |
| Wizards changes article format | CLI flags missing sections as errors and refuses to write; manual review report |
| Retailer titles omit the set or variant | Uncertain state + manual picker, remembered locally |
| Converted CAD ≠ Canadian retail reality | Always labelled “Estimated CAD MSRP”; official CAD wins if ever published |
| Box “MSRP” misunderstood | Derived values are separately typed, dashed badges, “est. benchmark” wording, can be hidden |
| Price includes shipping/tax inconsistently | Only the listed item price is read; shipping and tax are never added; disclosed in the popover |
| Marketplace / third-party sellers | Compared like any listing price (it is what the shopper pays before tax/shipping) |

## 6. Implementation plan (as executed)

1. Data: source registry → parser → builder → validator → bundled `products.json` (201 records).
2. Core: price parsing, FX, MSRP math, matching engine, all unit-tested.
3. Walmart adapter + fixtures, then Amazon.ca, EB Games, and 401 Games adapters.
4. Content controller (Shadow DOM badges, React popover, MutationObserver, SPA handling).
5. Background worker (Bank of Canada FX, database refresh), React popup with summary and settings.
6. End-to-end test of the built extension in Chromium against the fixtures.
