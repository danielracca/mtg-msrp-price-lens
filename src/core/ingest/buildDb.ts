import type { LegacySet, ProductCategory, ProductDatabase, ProductRecord, SetRecord } from '../types';
import { extractPublishedDate, extractTitle, htmlToLines } from './htmlText';

/* ------------------------------------------------------------------ */
/* Source registry types (scripts/db/sources.json)                     */
/* ------------------------------------------------------------------ */

export interface LabelVariant {
  variant: string;
  edition: ProductRecord['edition'];
  aliases: string[];
}

export interface SourceSetConfig {
  code: string;
  name: string;
  aliases: string[];
  releaseDate: string | null;
  releaseDateText?: string;
  universesBeyond: boolean;
  section?: { start: string; end?: string };
  supplementarySourceId?: string;
  crossCheckOnly?: boolean;
  labelAliases?: Record<string, string>;
  variantGroups?: Record<string, string[]>;
  labelVariants?: Record<string, LabelVariant>;
  /** Labels a maintainer has reviewed and assigned a category to. */
  reviewedLabels?: Record<string, ProductCategory>;
}

export interface SourceConfig {
  id: string;
  url: string;
  kind: 'announcement' | 'collecting' | 'supplementary';
  sets?: SourceSetConfig[];
}

export interface SourceRegistry {
  userAgent: string;
  requestDelayMs: number;
  sources: SourceConfig[];
  legacySets: { reason: string; names: string[][] };
}

export interface ReviewFlag {
  level: 'error' | 'warning' | 'info';
  sourceId: string;
  message: string;
}

/* ------------------------------------------------------------------ */
/* Parsing                                                             */
/* ------------------------------------------------------------------ */

export interface MsrpLine {
  label: string;
  usd: number;
  /** Line carried a footnote marker (e.g. "$26.99*"). */
  footnote: boolean;
  raw: string;
}

const PRICE_LINE = /^(.{2,80}?):\s*\$\s?(\d{1,4}(?:\.\d{2})?)(\*?)\s*(?:USD)?$/;

/**
 * Extracts "Label: $12.34" lines. With a section, parsing starts after the
 * start marker and stops at the end marker. Without a section, the first MSRP
 * heading is located and consecutive price lines are read.
 */
export function extractMsrpLines(lines: string[], section?: { start: string; end?: string }): MsrpLine[] {
  let startIdx: number;
  if (section) {
    startIdx = lines.findIndex((l) => l.includes(section.start));
    if (startIdx < 0) return [];
  } else {
    startIdx = lines.findIndex((l) => /^MSRPs\b/.test(l) || /^MSRPs? for .* will be set as follows/i.test(l));
    if (startIdx < 0) return [];
  }
  const out: MsrpLine[] = [];
  let misses = 0;
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (section?.end && line.includes(section.end)) break;
    const m = PRICE_LINE.exec(line);
    if (m) {
      out.push({ label: m[1].trim(), usd: Number(m[2]), footnote: m[3] === '*', raw: line });
      misses = 0;
    } else if (out.length > 0 && !section) {
      break;
    } else if (++misses > 4 && !section) {
      break;
    }
  }
  return out;
}

/** "Play Booster box includes 30 Play Boosters" / "Booster Pack box includes 30 Booster Packs". */
export function extractBoxPackCounts(lines: string[]): { play: number | null; collector: number | null } {
  const text = lines.join('\n');
  const play = /(?:Play Booster|Booster Pack) box(?:es)? (?:will )?(?:contains?|includes?) (\d+) (?:Play Boosters|Booster Packs)/i.exec(text);
  const coll = /Collector Booster box(?:es)? (?:will )?(?:contains?|includes?) (\d+) Collector Boosters/i.exec(text);
  return { play: play ? Number(play[1]) : null, collector: coll ? Number(coll[1]) : null };
}

/** Reads the named decks listed under the "Commander Decks" heading. */
export function extractCommanderDeckNames(lines: string[], setName: string): string[] {
  const start = lines.findIndex((l) => l === 'Commander Decks');
  if (start < 0) return [];
  const names: string[] = [];
  for (let i = start + 1; i < Math.min(lines.length, start + 30); i++) {
    const l = lines[i];
    if (/^(Each|We'll|Choose|1 |Magic: The Gathering)/.test(l) || /contains/.test(l) || l === setName) break;
    if (l === 'Commander Deck' || l === '|') continue;
    if (/^\(.*\)$/.test(l)) continue; // color identity on its own line
    names.push(l.replace(/\s*\([A-Za-z-]+\)\s*$/, '').trim());
  }
  return names.filter((n) => n.length > 1 && n.length < 60);
}

/* ------------------------------------------------------------------ */
/* Label → category mapping                                            */
/* ------------------------------------------------------------------ */

interface LabelMapping {
  category: ProductCategory;
  edition: ProductRecord['edition'];
  /** For named specialty products the label itself is the variant. */
  variantFromLabel?: boolean;
  usesVariantGroup?: boolean;
}

export function mapLabel(label: string): LabelMapping | null {
  const l = label.toLowerCase().replace(/’/g, "'");
  if (l === 'play booster' || l === 'booster pack') return { category: 'play_booster_pack', edition: 'standard' };
  if (l === 'collector booster') return { category: 'collector_booster_pack', edition: 'standard' };
  if (l === 'jumpstart booster') return { category: 'jumpstart_booster_pack', edition: 'standard' };
  if (l === 'bundle') return { category: 'bundle', edition: 'standard' };
  if (l === 'gift bundle') return { category: 'gift_bundle', edition: 'standard' };
  if (l === "commander's bundle") return { category: 'commander_bundle', edition: 'standard' };
  if (l === 'commander deck') return { category: 'commander_deck', edition: 'standard', usesVariantGroup: true };
  if (l === "collector's edition commander deck") return { category: 'commander_deck', edition: 'collectors_edition', usesVariantGroup: true };
  if (l === 'premium edition commander deck') return { category: 'commander_deck', edition: 'premium_edition', usesVariantGroup: true };
  if (/^[\w' ]+ commander deck$/.test(l)) return { category: 'commander_deck', edition: 'standard', usesVariantGroup: true };
  if (l === 'scene box') return { category: 'scene_box', edition: 'standard' };
  if (l === 'starter kit') return { category: 'starter_kit', edition: 'standard' };
  if (l === 'beginner box') return { category: 'beginner_box', edition: 'standard' };
  if (l === 'starter collection') return { category: 'starter_collection', edition: 'standard' };
  if (/theme deck$/.test(l)) return { category: 'theme_deck', edition: 'standard' };
  if (l === 'draft night') return { category: 'draft_night', edition: 'standard' };
  if (/ bundle$/.test(l)) return { category: 'specialty_bundle', edition: 'standard', variantFromLabel: true };
  return null;
}

const CATEGORY_NAMES: Record<ProductCategory, string> = {
  play_booster_pack: 'Play Booster',
  play_booster_box: 'Play Booster Box',
  collector_booster_pack: 'Collector Booster',
  collector_booster_box: 'Collector Booster Box',
  jumpstart_booster_pack: 'Jumpstart Booster',
  bundle: 'Bundle',
  gift_bundle: 'Gift Bundle',
  specialty_bundle: 'Bundle',
  commander_deck: 'Commander Deck',
  commander_bundle: "Commander's Bundle",
  prerelease_kit: 'Prerelease Pack',
  scene_box: 'Scene Box',
  starter_kit: 'Starter Kit',
  beginner_box: 'Beginner Box',
  starter_collection: 'Starter Collection',
  theme_deck: '60-Card Theme Deck',
  draft_night: 'Draft Night',
  other_sealed: 'Sealed Product',
};
export const categoryLabel = (c: ProductCategory) => CATEGORY_NAMES[c];

const EDITION_NAMES: Record<ProductRecord['edition'], string> = {
  standard: '',
  collectors_edition: "Collector's Edition ",
  premium_edition: 'Premium Edition ',
  game_edition: '',
};

export function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/['’!]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function productId(code: string, category: ProductCategory, variant: string | null, edition: string): string {
  return [code.toLowerCase(), category.replace(/_/g, '-'), variant ? slug(variant) : null, edition !== 'standard' ? edition.replace(/_/g, '-') : null]
    .filter(Boolean)
    .join('--');
}

/* ------------------------------------------------------------------ */
/* Build                                                               */
/* ------------------------------------------------------------------ */

export interface FetchedSource {
  config: SourceConfig;
  html: string;
}

export interface BuildResult {
  db: ProductDatabase;
  flags: ReviewFlag[];
}

export function buildDatabase(
  registry: SourceRegistry,
  fetched: Map<string, string>,
  opts: { today: string; dbVersion: string },
): BuildResult {
  const flags: ReviewFlag[] = [];
  const products = new Map<string, ProductRecord>();
  const sets = new Map<string, SetRecord>();
  const crossChecks: { sourceId: string; code: string; label: string; usd: number }[] = [];

  const addProduct = (p: ProductRecord, sourceId: string) => {
    const existing = products.get(p.id);
    if (existing) {
      if (existing.msrp.usd !== p.msrp.usd) {
        flags.push({ level: 'error', sourceId, message: `Conflicting MSRP for ${p.id}: ${existing.msrp.usd} vs ${p.msrp.usd}` });
        existing.verification = 'needs_review';
      } else {
        flags.push({ level: 'info', sourceId, message: `Duplicate record ${p.id} (same MSRP) — kept first` });
      }
      return;
    }
    products.set(p.id, p);
  };

  for (const source of registry.sources) {
    if (source.kind === 'supplementary' || !source.sets) continue;
    const html = fetched.get(source.id);
    if (!html) {
      flags.push({ level: 'error', sourceId: source.id, message: 'Source HTML not available (fetch failed or not cached)' });
      continue;
    }
    const lines = htmlToLines(html);
    const published = extractPublishedDate(lines);
    const title = extractTitle(html);
    if (!published) flags.push({ level: 'warning', sourceId: source.id, message: 'Publication date not found' });

    for (const set of source.sets) {
      const msrpLines = extractMsrpLines(lines, set.section);
      if (msrpLines.length === 0) {
        flags.push({ level: 'error', sourceId: source.id, message: `No MSRP lines found for ${set.code}` });
        continue;
      }
      if (set.crossCheckOnly) {
        for (const m of msrpLines) crossChecks.push({ sourceId: source.id, code: set.code, label: set.labelAliases?.[m.label] ?? m.label, usd: m.usd });
        continue;
      }

      // Supplementary text (release dates, box counts, prerelease) — same set, other official article.
      const suppHtml = set.supplementarySourceId ? fetched.get(set.supplementarySourceId) : undefined;
      if (set.supplementarySourceId && !suppHtml) {
        flags.push({ level: 'warning', sourceId: set.supplementarySourceId, message: `Supplementary source for ${set.code} unavailable` });
      }
      const allLines = suppHtml ? [...lines, ...htmlToLines(suppHtml)] : lines;
      const fullText = allLines.join('\n');

      if (set.releaseDateText && !fullText.includes(set.releaseDateText)) {
        flags.push({ level: 'warning', sourceId: source.id, message: `Release date text "${set.releaseDateText}" for ${set.code} not found in source — verify manually` });
      }

      sets.set(set.code, {
        code: set.code,
        name: set.name,
        aliases: set.aliases,
        releaseDate: set.releaseDate,
        universesBeyond: set.universesBeyond,
        sourceUrl: source.url,
        hasMsrp: true,
      });

      const parsedDecks = extractCommanderDeckNames(allLines, set.name);
      const groups = { ...(set.variantGroups ?? {}) };
      if (parsedDecks.length && !groups['Commander Deck']) groups['Commander Deck'] = parsedDecks;
      for (const [groupLabel, names] of Object.entries(groups)) {
        for (const n of names) {
          if (!fullText.includes(n)) flags.push({ level: 'warning', sourceId: source.id, message: `Variant "${n}" (${groupLabel}, ${set.code}) not found in source text` });
        }
      }

      const base = {
        setName: set.name,
        setCode: set.code,
        releaseDate: set.releaseDate,
        upc: [] as string[],
        lastVerified: opts.today,
      };
      const msrpBase = { cad: null, sourceUrl: source.url, sourceTitle: title, sourcePublishedDate: published };

      for (const line of msrpLines) {
        const labelVariant = set.labelVariants?.[line.label];
        const reviewed = set.reviewedLabels?.[line.label];
        const mapping: LabelMapping | null = reviewed
          ? { category: reviewed, edition: 'standard', variantFromLabel: true }
          : mapLabel(line.label);
        if (!mapping && !labelVariant) {
          flags.push({ level: 'warning', sourceId: source.id, message: `Unrecognized product label "${line.label}" (${set.code}) — stored as other_sealed, needs review` });
        }
        const category: ProductCategory = labelVariant ? 'commander_deck' : mapping?.category ?? 'other_sealed';
        const edition = labelVariant?.edition ?? mapping?.edition ?? 'standard';
        const note = line.footnote ? 'Source marks this MSRP with a footnote (price change vs. previous sets).' : undefined;

        const make = (variant: string | null, extraAliases: string[], verification: ProductRecord['verification']): ProductRecord => {
          const ed = EDITION_NAMES[edition];
          const name =
            category === 'specialty_bundle' || category === 'other_sealed'
              ? `${set.name} ${line.label}`
              : variant
                ? `${set.name} ${variant} ${ed}${categoryLabel(category)}`
                : `${set.name} ${ed}${categoryLabel(category)}`;
          return {
            ...base,
            id: productId(set.code, category, variant, edition),
            name: name.replace(/\s+/g, ' ').trim(),
            aliases: [...new Set([line.label, ...extraAliases])],
            category,
            variant,
            edition,
            packCount: category.endsWith('_pack') ? 1 : null,
            msrp: { ...msrpBase, classification: 'official', usd: line.usd, sourceLabel: line.raw, note },
            verification,
          };
        };

        if (labelVariant) {
          addProduct(make(labelVariant.variant, labelVariant.aliases, 'verified'), source.id);
          continue;
        }
        if (mapping?.variantFromLabel || category === 'other_sealed') {
          addProduct(make(line.label, [], mapping ? 'verified' : 'needs_review'), source.id);
          continue;
        }
        if (mapping?.usesVariantGroup) {
          const names = groups[line.label] ?? (edition === 'standard' ? undefined : undefined);
          if (names && names.length) {
            for (const n of names) addProduct(make(n, [n], 'verified'), source.id);
          } else {
            flags.push({ level: 'info', sourceId: source.id, message: `No named variants for "${line.label}" (${set.code}); generic record created` });
          }
          // A generic record always exists so a deck can be matched when its variant name is absent.
          addProduct(make(null, [], 'verified'), source.id);
          continue;
        }
        addProduct(make(null, [], 'verified'), source.id);
      }

      // Booster boxes: never an official MSRP — derived "combined pack MSRP" benchmark when pack count is published.
      const counts = extractBoxPackCounts(allLines);
      const boxes: [ProductCategory, ProductCategory, number | null][] = [
        ['play_booster_box', 'play_booster_pack', counts.play],
        ['collector_booster_box', 'collector_booster_pack', counts.collector],
      ];
      for (const [boxCat, packCat, count] of boxes) {
        const pack = products.get(productId(set.code, packCat, null, 'standard'));
        if (!pack) continue;
        const id = productId(set.code, boxCat, null, 'standard');
        addProduct(
          {
            ...base,
            id,
            name: `${set.name} ${categoryLabel(boxCat)}`,
            aliases: [],
            category: boxCat,
            variant: null,
            edition: 'standard',
            packCount: count,
            msrp: count
              ? {
                  ...msrpBase,
                  classification: 'derived',
                  usd: null,
                  derivation: { method: 'combined_pack_msrp', fromProductId: pack.id, quantity: count },
                  note: `No official box MSRP. Benchmark = ${count} × official ${categoryLabel(packCat)} MSRP (pack count from source).`,
                }
              : {
                  ...msrpBase,
                  classification: 'unavailable',
                  usd: null,
                  note: 'No official box MSRP and the pack count is not stated in the official source.',
                },
            verification: 'verified',
          },
          source.id,
        );
        if (!count) flags.push({ level: 'info', sourceId: source.id, message: `Pack count for ${set.code} ${boxCat} not in source — benchmark unavailable` });
      }

      // Prerelease packs: Wizards does not publish an MSRP. Only created when the source mentions them.
      if (/Prerelease Pack|Prerelease Kit/i.test(fullText)) {
        addProduct(
          {
            ...base,
            id: productId(set.code, 'prerelease_kit', null, 'standard'),
            name: `${set.name} Prerelease Pack`,
            aliases: ['Prerelease Kit', 'Prerelease Pack'],
            category: 'prerelease_kit',
            variant: null,
            edition: 'standard',
            packCount: null,
            msrp: { ...msrpBase, classification: 'unavailable', usd: null, note: 'Wizards does not publish an MSRP for Prerelease Packs.' },
            verification: 'verified',
          },
          source.id,
        );
      }
    }
  }

  // Cross-check: secondary sources must agree with primary records.
  for (const c of crossChecks) {
    const mapping = mapLabel(c.label);
    const matches = [...products.values()].filter(
      (p) => p.setCode === c.code && (p.aliases.includes(c.label) || (mapping && p.category === mapping.category && p.edition === mapping.edition && !mapping.variantFromLabel && p.variant === null)),
    );
    if (matches.length === 0) {
      flags.push({ level: 'warning', sourceId: c.sourceId, message: `Cross-check: no record for ${c.code} "${c.label}"` });
    }
    for (const p of matches) {
      if (p.msrp.usd !== c.usd) {
        flags.push({ level: 'error', sourceId: c.sourceId, message: `Cross-check conflict ${p.id}: ${p.msrp.usd} vs ${c.usd}` });
        p.verification = 'needs_review';
      }
    }
  }

  // A generic (variant-less) Commander deck record is only safe when every deck of
  // that set + edition shares one MSRP; otherwise an unnamed deck cannot be priced.
  for (const p of [...products.values()]) {
    if (p.category !== 'commander_deck' || p.variant !== null) continue;
    const siblings = [...products.values()].filter((q) => q.setCode === p.setCode && q.category === 'commander_deck' && q.edition === p.edition && q.variant !== null);
    if (siblings.some((q) => q.msrp.usd !== p.msrp.usd)) {
      products.delete(p.id);
      flags.push({ level: 'info', sourceId: 'build', message: `Generic ${p.id} removed: ${p.setCode} decks have different MSRPs, variant must be identified` });
    }
  }

  const legacySets: LegacySet[] = registry.legacySets.names.map(([name, ...aliases]) => ({ name, aliases, reason: registry.legacySets.reason }));

  const db: ProductDatabase = {
    schemaVersion: 1,
    dbVersion: opts.dbVersion,
    generatedAt: opts.today,
    coverageNote:
      'Sealed products from Magic: The Gathering Foundations onward where Wizards of the Coast published an official USD MSRP. Booster box benchmarks are derived (pack count × pack MSRP) and are never official.',
    sets: [...sets.values()].sort((a, b) => (a.releaseDate ?? '').localeCompare(b.releaseDate ?? '')),
    legacySets,
    products: [...products.values()].sort((a, b) => (a.releaseDate ?? '').localeCompare(b.releaseDate ?? '') || a.id.localeCompare(b.id)),
  };
  return { db, flags };
}
