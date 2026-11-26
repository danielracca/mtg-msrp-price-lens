import type { ProductCategory, ProductRecord } from '../types';
import { normalizeTitle, toNumber } from './normalize';

const NUM = '(\\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|twelve|pair|double|triple)';

export function hasMtgSignal(n: string): boolean {
  return / magic the gathering | mtg | magic gathering | magic tcg | magic (?:trading )?card game /.test(n) || / magic .*(?:booster|commander|bundle|deck) /.test(n);
}

/** Non-sealed items: proxies, graded singles, accessories, empty packaging… */
export function exclusionReason(n: string, hasCategory: boolean): string | null {
  const hard: [RegExp, string][] = [
    [/ (?:proxy|proxies|custom made|custom|replica|fake|counterfeit|reproduction|orica) /, 'proxy/custom item'],
    [/ (?:empty|no cards|packaging only|box only|wrapper|opened|unsealed|resealed) /, 'empty or opened packaging'],
    [/ (?:psa|bgs|cgc|graded) /, 'graded single card'],
    [/ (?:sleeves?|playmat|play mat|binder|toploaders?|deck box|deckbox|dice|spindown|life counter|card storage|storage box|card case|portfolio) /, 'accessory'],
    [/ (?:t shirt|shirt|hoodie|mug|poster|plush|keychain|figure|funko|puzzle|novel|lego|socks|backpack|costume) /, 'merchandise'],
    [/ (?:single card|singles?|near mint|nm m|lightly played|played condition|light play|foil card|card lot|bulk cards?|random cards?|\d+ random) /, 'single card or card lot'],
  ];
  for (const [re, why] of hard) {
    if (!re.test(n)) continue;
    // Sealed decks/bundles mention "deck box"/"dice"/"sleeves" among their contents; only accessories without a sealed category are excluded.
    if (hasCategory && (why === 'accessory' || why === 'merchandise')) continue;
    return why;
  }
  return null;
}

/**
 * Returns plausible categories, most specific first. Order matters: bundles and decks
 * mention "Play Boosters"/"Collector Booster Sample Pack" among their contents.
 */
export function detectCategories(n: string): ProductCategory[] {
  const out: ProductCategory[] = [];
  const add = (c: ProductCategory) => !out.includes(c) && out.push(c);
  const boxish = / (?:box|display|case of (?:30|36|12|24) boosters|booster box) /.test(n) || /(?: 30| 36| 12) (?:packs?|boosters?|booster packs|count|ct|pk) /.test(n);

  if (/ prerelease /.test(n)) add('prerelease_kit');
  if (/ gift (?:edition )?bundle /.test(n)) add('gift_bundle');
  if (/ commanders bundle /.test(n)) add('commander_bundle');
  if (/ scene box /.test(n)) add('scene_box');
  if (/ starter kit /.test(n)) add('starter_kit');
  if (/ beginner box /.test(n)) add('beginner_box');
  if (/ starter collection /.test(n)) add('starter_collection');
  if (/ draft night /.test(n)) add('draft_night');
  if (/ (?:60 card )?theme deck /.test(n)) add('theme_deck');
  if (/ team up /.test(n)) add('other_sealed');
  if (out.length) return out;

  const commander = / commander (?:deck|decks|precon|preconstructed)|precon|preconstructed (?:commander )?deck|collectors edition commander|commander collectors edition /.test(n);
  if (/ bundle /.test(n) && !/ commander (?:deck )?bundle /.test(n) && !commander) {
    add('bundle');
    add('specialty_bundle');
    return out;
  }
  if (commander || / commander bundle /.test(n)) {
    add('commander_deck');
    if (/ commander bundle /.test(n)) add('commander_bundle');
    return out;
  }
  if (/ collector (?:booster|boosters|pack|packs) /.test(n) || / collector booster /.test(n) || / collectors booster /.test(n)) {
    add(boxish ? 'collector_booster_box' : 'collector_booster_pack');
    return out;
  }
  if (/ jumpstart /.test(n)) {
    add('jumpstart_booster_pack');
    return out;
  }
  if (/ (?:play )?booster (?:box|display) |booster box/.test(n)) {
    add('play_booster_box');
    return out;
  }
  if (/ (?:play booster|play boosters|booster pack|booster packs|draft booster|boosters?) /.test(n) || / booster pack /.test(n)) {
    add(boxish ? 'play_booster_box' : 'play_booster_pack');
    return out;
  }
  return out;
}

export function detectEdition(n: string): ProductRecord['edition'] {
  if (/ collectors? edition /.test(n)) return 'collectors_edition';
  if (/ premium edition /.test(n)) return 'premium_edition';
  if (/ game edition | ffvii | final fantasy vii | ff7 | ff vii /.test(n)) return 'game_edition';
  return 'standard';
}

export interface QuantityInfo {
  /** Number of sellable units (decks, bundles, packs…) in the listing. */
  units: number;
  /** Booster pack count stated by the listing (e.g. "30 packs"). */
  packCount: number | null;
  /** Listing suggests multiple units but the number is unclear (e.g. "case", "complete set"). */
  ambiguousMulti: boolean;
}

export function detectQuantity(n: string, category: ProductCategory | null): QuantityInfo {
  let units = 1;
  let packCount: number | null = null;
  let ambiguousMulti = false;

  const pc = new RegExp(` ${NUM} (?:play |collector |draft )?(?:booster )?(?:packs|boosters|booster packs|count|ct|pk) `).exec(n) ?? / box of (\d{2}) /.exec(n);
  if (pc) packCount = toNumber(pc[1]);

  const unitPatterns: RegExp[] = [
    new RegExp(` (?:set|lot|pack|bundle|case|carton|bundle of all) of ${NUM} `),
    new RegExp(` (?:all )?${NUM} (?:different )?(?:commander )?decks `),
    new RegExp(` ${NUM} (?:bundles|gift bundles|scene boxes|boxes|displays|kits|starter kits|beginner boxes) `),
    new RegExp(` ${NUM} ?x `),
    new RegExp(` x ?${NUM} `),
    new RegExp(` ${NUM} (?:pack|pk) (?:commander|deck|bundle)`),
  ];
  for (const re of unitPatterns) {
    const m = re.exec(n);
    if (!m) continue;
    const v = toNumber(m[1]);
    if (v && v > 1 && v < 100) {
      units = v;
      break;
    }
  }

  const isPackCategory = category === 'play_booster_pack' || category === 'collector_booster_pack' || category === 'jumpstart_booster_pack';
  if (isPackCategory && packCount && packCount > 1 && units === 1) {
    units = packCount;
    packCount = null;
  }
  if (category && category.endsWith('_box') && units === packCount) units = 1;

  if (/ (?:case|carton|master case|sealed case) /.test(n) && units === 1) ambiguousMulti = true;
  if (/ (?:complete set|full set|set of all|all decks|all commander decks|every deck) /.test(n) && units === 1) ambiguousMulti = true;
  return { units, packCount, ambiguousMulti };
}

export { normalizeTitle };
