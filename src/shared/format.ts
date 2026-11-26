import type { PageItem } from '../content/evaluate';
import type { Tier } from '../core/msrp';

export const cad = (n: number) => `$${n.toFixed(2)} CAD`;
export const usd = (n: number) => `$${n.toFixed(2)} USD`;
export const signedCad = (n: number) => `${n < 0 ? '−' : '+'}$${Math.abs(n).toFixed(2)}`;

export interface BadgeView {
  icon: string;
  text: string;
  tone: Tier | 'muted' | 'uncertain';
  estimated: boolean;
  /** Accessible description (screen readers + tooltip). */
  aria: string;
}

const TIER_ICON: Record<Tier, string> = { great: '▼', good: '▼', neutral: '●', high: '▲', very_high: '▲' };

export function badgeView(item: PageItem): BadgeView {
  switch (item.state) {
    case 'compared': {
      const c = item.comparison!;
      const pct = Math.abs(c.diffPct);
      const benchmark = c.reference.basis === 'derived_benchmark';
      const target = benchmark ? 'est. benchmark' : 'MSRP';
      // Truncate (never round up) so the badge never overstates a discount or crosses a tier boundary.
      const text = c.tier === 'neutral' ? `At ${target}` : `${Math.floor(pct + 1e-9)}% ${c.diffPct < 0 ? 'below' : 'above'} ${target}`;
      return {
        icon: TIER_ICON[c.tier],
        text,
        tone: c.tier,
        estimated: benchmark,
        aria: `MTG Price Lens: ${text}${c.tier === 'neutral' ? ` (${c.diffPct >= 0 ? '+' : '−'}${pct.toFixed(1)}%)` : ''}. Click for details.`,
      };
    }
    case 'legacy':
      return { icon: '○', text: 'MSRP unavailable', tone: 'muted', estimated: false, aria: 'MTG Price Lens: no official MSRP was published for this set. Click for details.' };
    case 'msrp_unavailable':
      return { icon: '○', text: 'MSRP unavailable', tone: 'muted', estimated: false, aria: 'MTG Price Lens: no official MSRP for this product. Click for details.' };
    case 'benchmark_hidden':
      return { icon: '○', text: 'No official MSRP', tone: 'muted', estimated: false, aria: 'MTG Price Lens: only an estimated benchmark exists (hidden in settings). Click for details.' };
    case 'no_price':
      return { icon: '○', text: 'Price not detected', tone: 'muted', estimated: false, aria: 'MTG Price Lens: the selling price could not be read. Click for details.' };
    case 'uncertain':
    default:
      return { icon: '?', text: 'Product match uncertain', tone: 'uncertain', estimated: false, aria: 'MTG Price Lens: product match uncertain. Click to choose the product.' };
  }
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
}
