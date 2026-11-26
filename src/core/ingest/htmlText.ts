/**
 * Minimal, dependency-free HTML → text conversion for official source articles.
 * Block-level elements become line breaks; inline elements (em, a, strong…) are
 * flattened so that "<em>Foundations</em> products will…" stays on one line.
 */
const BLOCK_TAGS =
  'address|article|aside|blockquote|br|dd|div|dl|dt|fieldset|figcaption|figure|footer|form|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|table|tbody|td|tfoot|th|thead|tr|ul|time|img';

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘',
  ldquo: '“', rdquo: '”', ndash: '–', mdash: '—', hellip: '…', trade: '™', reg: '®', copy: '©',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

export function htmlToLines(html: string): string[] {
  let t = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, '');
  t = t.replace(new RegExp(`<\\/?(?:${BLOCK_TAGS})\\b[^>]*>`, 'gi'), '\n');
  t = t.replace(/<[^>]+>/g, '');
  t = decodeEntities(t);
  return t
    .split('\n')
    .map((l) => l.replace(/[\s ]+/g, ' ').trim())
    .filter(Boolean);
}

const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

/** Wizards articles show the publication date as e.g. "Oct 25, 2024" near the title. */
export function extractPublishedDate(lines: string[]): string | null {
  for (const l of lines.slice(0, 200)) {
    const m = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* (\d{1,2}), (20\d{2})$/.exec(l);
    if (m) return `${m[3]}-${MONTHS[m[1].toLowerCase()]}-${m[2].padStart(2, '0')}`;
  }
  return null;
}

export function extractTitle(html: string): string | null {
  const og = /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i.exec(html);
  if (og) return decodeEntities(og[1]).trim();
  const t = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return t ? decodeEntities(t[1]).replace(/\s+/g, ' ').trim() : null;
}
