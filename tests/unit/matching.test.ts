import { describe, expect, it } from 'vitest';
import db from '../../data/products.json';
import type { ProductDatabase } from '../../src/core/types';
import { buildIndex, matchListing } from '../../src/core/matching/matcher';

const index = buildIndex(db as ProductDatabase);
const m = (title: string, upc: string | null = null) => matchListing({ title, upc, description: null }, index);

describe('matching: correct identification', () => {
  const cases: [string, string, number?][] = [
    ['Magic: The Gathering Foundations Play Booster', 'fdn--play-booster-pack'],
    ['Magic: The Gathering Foundations Collector Booster', 'fdn--collector-booster-pack'],
    ['Magic: The Gathering Foundations Bundle - 9 Play Boosters, 30 Land Cards + Exclusive Accessories', 'fdn--bundle'],
    ['Magic: The Gathering Foundations Beginner Box', 'fdn--beginner-box'],
    ['Magic: The Gathering Foundations Starter Collection', 'fdn--starter-collection'],
    ['Magic The Gathering Foundations Jumpstart Booster', 'fdn--jumpstart-booster-pack'],
    ['Magic: The Gathering Aetherdrift Commander Deck – Living Energy (100-Card Deck, 2-Card Collector Booster Sample Pack + Accessories)', 'dft--commander-deck--living-energy'],
    ['Magic: The Gathering Aetherdrift Commander Deck - Eternal Might', 'dft--commander-deck--eternal-might'],
    ['Magic: The Gathering Aetherdrift Finish Line Bundle', 'dft--specialty-bundle--finish-line-bundle'],
    ['Magic: The Gathering Tarkir: Dragonstorm Play Booster Box - 30 Packs', 'tdm--play-booster-box'],
    ['MTG Tarkir Dragonstorm Collector Booster Box (12 Packs)', 'tdm--collector-booster-box'],
    ['Magic: The Gathering Tarkir: Dragonstorm Commander Deck - Temur Roar', 'tdm--commander-deck--temur-roar'],
    ['Magic: The Gathering | FINAL FANTASY Gift Bundle', 'fin--gift-bundle'],
    ['Magic: The Gathering FINAL FANTASY Bundle', 'fin--bundle'],
    ['Magic: The Gathering - FINAL FANTASY Commander Deck Collector\'s Edition – Limit Break', 'fin--commander-deck--limit-break--collectors-edition'],
    ['Magic: The Gathering FINAL FANTASY Commander Deck - Revival Trance', 'fin--commander-deck--revival-trance'],
    ['Magic: The Gathering FINAL FANTASY VII Commander Deck – Game Edition', 'fin--commander-deck--limit-break-final-fantasy-vii-game-edition--game-edition'],
    ['Magic: The Gathering FINAL FANTASY Chocobo Bundle', 'fin--specialty-bundle--chocobo-bundle'],
    ['Magic The Gathering Edge of Eternities Collector Booster', 'eoe--collector-booster-pack'],
    ["Magic: The Gathering Marvel's Spider-Man Scene Box", 'spm--scene-box'],
    ['Magic: The Gathering | Avatar: The Last Airbender Commander\'s Bundle', 'tla--commander-bundle'],
    ['Magic: The Gathering Lorwyn Eclipsed Commander Deck - Blight Curse', 'ecl--commander-deck--blight-curse'],
    ['Magic: The Gathering Teenage Mutant Ninja Turtles Pizza Bundle', 'tmt--specialty-bundle--pizza-bundle'],
    ['Magic: The Gathering Secrets of Strixhaven Commander Deck - Lorehold Spirit', 'sos--commander-deck--lorehold-spirit'],
    ['Magic: The Gathering Marvel Super Heroes Commander Deck Collector\'s Edition - Doom Prevails', 'msh--commander-deck--doom-prevails--collectors-edition'],
    ['Magic: The Gathering Reality Fracture Foundations Commander Deck – Reign of Dragons', 'fra--commander-deck--reign-of-dragons'],
    ['Magic: The Gathering Foundations Commander Deck - Tramplesaurus Rex', 'fra--commander-deck--tramplesaurus-rex'],
    ['Magic: The Gathering Reality Fracture Multiverse Reforged Commander Deck', 'fra--commander-deck--multiverse-reforged'],
    ['Magic: The Gathering Star Trek Commander Deck - We Are the Borg', 'trk--commander-deck--we-are-the-borg'],
    ['Magic: The Gathering The Hobbit Play Booster Box', 'hob--play-booster-box'],
  ];
  for (const [title, id] of cases) {
    it(title, () => {
      const r = m(title);
      expect(r.status, r.reasons.join(' | ')).toBe('matched');
      expect(r.product?.id).toBe(id);
      expect(r.confidence).toBeGreaterThanOrEqual(0.75);
    });
  }
});

describe('matching: distinguishes similar products', () => {
  it('single booster vs booster box', () => {
    expect(m('MTG Edge of Eternities Play Booster Pack').product?.id).toBe('eoe--play-booster-pack');
    expect(m('MTG Edge of Eternities Play Booster Box').product?.id).toBe('eoe--play-booster-box');
    expect(m('Magic the Gathering Edge of Eternities Play Booster Display (30 Packs)').product?.id).toBe('eoe--play-booster-box');
  });
  it('gift bundle vs regular bundle', () => {
    expect(m('Magic: The Gathering Marvel Super Heroes Gift Bundle').product?.id).toBe('msh--gift-bundle');
    expect(m('Magic: The Gathering Marvel Super Heroes Bundle').product?.id).toBe('msh--bundle');
  });
  it('gift bundle for a set without one is uncertain, never falls back to regular bundle', () => {
    const r = m('Magic: The Gathering Aetherdrift Gift Bundle');
    expect(r.status).toBe('uncertain');
  });
  it('collector vs play boosters', () => {
    expect(m('Magic: The Gathering Lorwyn Eclipsed Collector Booster').product?.id).toBe('ecl--collector-booster-pack');
    expect(m('Magic: The Gathering Lorwyn Eclipsed Play Booster').product?.id).toBe('ecl--play-booster-pack');
  });
  it('commander deck mentioning a Collector Booster Sample Pack stays a commander deck', () => {
    expect(m('Magic: The Gathering Edge of Eternities Commander Deck - World Shaper + Collector Booster Sample Pack').product?.id).toBe('eoe--commander-deck--world-shaper');
  });
  it('different commander decks of the same set', () => {
    expect(m('MTG Secrets of Strixhaven Commander Deck: Quandrix Unlimited').product?.id).toBe('sos--commander-deck--quandrix-unlimited');
    expect(m('MTG Secrets of Strixhaven Commander Deck: Prismari Artistry').product?.id).toBe('sos--commander-deck--prismari-artistry');
  });
  it('unnamed commander deck matches generic record when all decks share an MSRP', () => {
    const r = m('Magic: The Gathering Lorwyn Eclipsed Commander Deck');
    expect(r.status).toBe('matched');
    expect(r.product?.id).toBe('ecl--commander-deck');
  });
  it('unnamed commander deck is uncertain when decks have different MSRPs', () => {
    const r = m('Magic: The Gathering Reality Fracture Commander Deck');
    expect(r.status).toBe('uncertain');
    expect(r.candidates.length).toBeGreaterThan(1);
  });
  it('standard vs premium / collector\'s editions', () => {
    expect(m('Magic: The Gathering Nauctis: The Sunken Realm Commander Deck - Seal the Deal').product?.id).toBe('nau--commander-deck--seal-the-deal');
    expect(m('Magic: The Gathering Nauctis: The Sunken Realm Premium Edition Commander Deck - Seal the Deal').product?.id).toBe('nau--commander-deck--seal-the-deal--premium-edition');
    expect(m('Magic: The Gathering Star Trek Collector\'s Edition Commander Deck - Klingon Fury').product?.id).toBe('trk--commander-deck--klingon-fury--collectors-edition');
  });
  it('collector\'s edition requested for a set without one is uncertain', () => {
    expect(m('Magic: The Gathering Edge of Eternities Collector\'s Edition Commander Deck').status).toBe('uncertain');
  });
});

describe('matching: multi-unit listings', () => {
  it('set of commander decks', () => {
    const r = m('Magic: The Gathering Tarkir: Dragonstorm Commander Deck Bundle - Set of 5 Decks');
    expect(r.status).toBe('matched');
    expect(r.quantity).toBe(5);
  });
  it('all 2 commander decks', () => {
    const r = m('MTG Aetherdrift Commander Decks - Both Decks (2 Decks) Living Energy + Eternal Might');
    expect(r.status).toBe('uncertain'); // two variants named → user decides
  });
  it('multi-pack of boosters', () => {
    const r = m('Magic: The Gathering Foundations Play Booster - 3 Packs');
    expect(r.product?.id).toBe('fdn--play-booster-pack');
    expect(r.quantity).toBe(3);
  });
  it('single scene box vs carton', () => {
    expect(m("Magic: The Gathering Marvel's Spider-Man Scene Box").quantity).toBe(1);
    expect(m("Magic: The Gathering Marvel's Spider-Man Scene Box - Case of 6").quantity).toBe(6);
    expect(m("Magic: The Gathering Marvel's Spider-Man Scene Box Carton").status).toBe('uncertain');
  });
  it('box with a pack count that contradicts the official count is uncertain', () => {
    expect(m('MTG Tarkir Dragonstorm Play Booster Box 36 Packs').status).toBe('uncertain');
  });
});

describe('matching: ignores non-sealed and handles unknowns', () => {
  const ignored = [
    'Magic: The Gathering Sol Ring - Foundations Single Card Near Mint',
    'Ultra Pro Magic: The Gathering Foundations Deck Protector Sleeves (100ct)',
    'Magic: The Gathering FINAL FANTASY Playmat',
    'MTG Proxy Commander Deck Custom 100 cards',
    'Empty Magic The Gathering Foundations Collector Booster Box (no cards)',
    'Star Trek Bundle Lego Enterprise Set',
    'Pokemon Scarlet & Violet Booster Bundle',
    'Avatar The Last Airbender Complete Series Blu-ray',
  ];
  for (const t of ignored) it(`ignores: ${t}`, () => expect(m(t).status).toBe('not_sealed'));

  it('legacy sets get MSRP unavailable', () => {
    const r = m('Magic: The Gathering Duskmourn: House of Horror Play Booster Box');
    expect(r.status).toBe('legacy');
    expect(r.legacySetName).toBe('Duskmourn: House of Horror');
  });
  it('unknown set is uncertain', () => {
    expect(m('Magic: The Gathering Play Booster Box Mystery Set').status).toBe('uncertain');
  });
  it('two sets in one title is uncertain', () => {
    expect(m('Magic: The Gathering Aetherdrift and Tarkir Dragonstorm Play Booster Bundle').status).toBe('uncertain');
  });
  it('licensed set without a Magic signal is ignored', () => {
    expect(m('Star Trek Collector\'s Edition Blu-ray Box Set').status).toBe('not_sealed');
  });
});

describe('matching: UPC', () => {
  it('matches by UPC when the DB has one', () => {
    const local = structuredClone(db) as ProductDatabase;
    local.products.find((p) => p.id === 'eoe--bundle')!.upc = ['195166289874'];
    const r = matchListing({ title: 'Some unclear title', upc: '0195166289874', description: null }, buildIndex(local));
    expect(r.method).toBe('upc');
    expect(r.product?.id).toBe('eoe--bundle');
  });
});
