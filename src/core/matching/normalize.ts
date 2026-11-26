/** Lowercases, strips trademarks/diacritics/punctuation and collapses whitespace. */
export function normalizeTitle(s: string): string {
  return ` ${s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[™®©]/g, '')
    .replace(/[’‘`´]/g, "'")
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/(\w)'s\b/g, '$1s')
    .replace(/'/g, '')
    .replace(/[^a-z0-9$.]+/g, ' ')
    .replace(/(?<!\d)\.|\.(?!\d)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()} `;
}

/** Normalized phrase containment on word boundaries (both sides normalized). */
export function containsPhrase(normalizedHaystack: string, phrase: string): boolean {
  const p = normalizeTitle(phrase);
  if (p.trim().length === 0) return false;
  return normalizedHaystack.includes(p);
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12,
  single: 1, pair: 2, double: 2, triple: 3,
};

export function toNumber(s: string): number | null {
  if (/^\d+$/.test(s)) return Number(s);
  return NUMBER_WORDS[s] ?? null;
}

/** Sørensen–Dice coefficient on character bigrams — used only as a tie-breaker. */
export function diceSimilarity(a: string, b: string): number {
  const A = bigrams(a);
  const B = bigrams(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const [g, n] of A) inter += Math.min(n, B.get(g) ?? 0);
  const total = [...A.values()].reduce((x, y) => x + y, 0) + [...B.values()].reduce((x, y) => x + y, 0);
  return (2 * inter) / total;
}

function bigrams(s: string): Map<string, number> {
  const t = s.replace(/\s+/g, ' ').trim();
  const m = new Map<string, number>();
  for (let i = 0; i < t.length - 1; i++) {
    const g = t.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}
