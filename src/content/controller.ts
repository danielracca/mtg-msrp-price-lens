import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { BADGE_TAG, type DetectedItem, OVERLAY_TAG, type RetailerAdapter } from '../adapters/common';
import type { EffectiveRate } from '../core/fx';
import { buildIndex, type MatcherIndex } from '../core/matching/matcher';
import type { Settings } from '../core/settings';
import type { ProductDatabase } from '../core/types';
import type { PageSummary, SummaryItem } from '../shared/messages';
import { type BadgeHost, renderBadge } from './badge';
import { evaluateListing, isBadgeVisible, mappingKey, type PageItem } from './evaluate';
import { Popover, POPOVER_CSS } from './Popover';

export interface ContentState {
  db: ProductDatabase;
  settings: Settings;
  fx: EffectiveRate | null;
  mappings: Record<string, string>;
}

export interface ControllerDeps {
  saveMapping(key: string, productId: string | null): Promise<void>;
}

interface Tracked {
  detected: DetectedItem;
  item: PageItem;
  host: BadgeHost | null;
  sig: string;
}

/**
 * Owns detection + rendering on one page. Idempotent: scanning the same DOM twice
 * never creates duplicate badges, and re-rendered cards (React/Next re-hydration,
 * infinite scroll, SPA navigation) are picked up by a debounced MutationObserver.
 */
export class PageController {
  private index: MatcherIndex;
  private tracked = new Map<string, Tracked>();
  private observer: MutationObserver | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastUrl: string;
  private overlay: { host: HTMLElement; root: Root } | null = null;
  private openKey: string | null = null;
  scans = 0;

  constructor(
    private adapter: RetailerAdapter,
    private state: ContentState,
    private deps: ControllerDeps,
    private doc: Document = document,
    private win: Window = window,
  ) {
    this.index = buildIndex(state.db);
    this.lastUrl = win.location.href;
  }

  start() {
    this.scan();
    this.observer = new MutationObserver((records) => {
      // Ignore mutations caused by our own badges/overlay.
      const relevant = records.some((r) => {
        const t = r.target as Element;
        if (t.nodeType === 1 && (t.closest?.(BADGE_TAG) || t.closest?.(OVERLAY_TAG))) return false;
        const nodes = [...Array.from(r.addedNodes), ...Array.from(r.removedNodes)];
        if (nodes.length && nodes.every((n) => n.nodeType === 1 && [BADGE_TAG, OVERLAY_TAG].includes((n as Element).tagName.toLowerCase()))) return false;
        return true;
      });
      if (relevant) this.schedule();
    });
    this.observer.observe(this.doc.body, { childList: true, subtree: true, characterData: true });
    this.win.addEventListener('popstate', () => this.schedule());
  }

  stop() {
    this.observer?.disconnect();
    if (this.timer) clearTimeout(this.timer);
    this.closePopover();
  }

  schedule(delay = 200) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.scan();
    }, delay);
  }

  updateState(next: Partial<ContentState>) {
    if (next.db && next.db !== this.state.db) this.index = buildIndex(next.db);
    this.state = { ...this.state, ...next };
    this.scan(true);
  }

  /** Detect products and (re)render badges. `force` re-evaluates unchanged items (settings/FX changed). */
  scan(force = false) {
    this.scans++;
    const url = new URL(this.win.location.href);
    if (url.href !== this.lastUrl) {
      // SPA navigation: forget items no longer in the DOM.
      this.lastUrl = url.href;
      this.closePopover();
    }
    const found = this.adapter.scan(this.doc, url);
    const seen = new Set<string>();
    for (const d of found) {
      if (seen.has(d.key)) continue;
      seen.add(d.key);
      const sig = `${d.listing.title}|${d.listing.price?.amount ?? ''}|${d.listing.upc ?? ''}`;
      const prev = this.tracked.get(d.key);
      const hostStillAttached = prev?.host?.isConnected && prev.detected.root === d.root;
      if (!force && prev && prev.sig === sig && hostStillAttached) continue;

      const item = evaluateListing(d.key, d.listing, this.index, this.state.fx, this.state.settings, this.state.mappings);
      const visible = isBadgeVisible(item, this.state.settings);
      let host: BadgeHost | null = null;
      if (item.state !== 'ignored') {
        host = renderBadge(d.anchor, item, visible, (h) => this.openPopover(d.key, h));
      } else {
        // An item can become ignored after a manual correction: remove its badge.
        prev?.host?.remove();
      }
      this.tracked.set(d.key, { detected: d, item, host, sig });
      if (this.openKey === d.key) this.renderPopover();
    }
    // Drop items whose cards left the DOM (pagination / SPA navigation).
    for (const [k, t] of this.tracked) {
      if (!seen.has(k) && !t.detected.root.isConnected) this.tracked.delete(k);
    }
  }

  items(): PageItem[] {
    return [...this.tracked.values()].map((t) => t.item);
  }

  summary(): PageSummary {
    const items = this.items().filter((i) => i.state !== 'ignored');
    const toSummary = (i: PageItem): SummaryItem => ({
      key: i.key,
      title: i.title,
      productName: i.product?.name ?? null,
      state: i.state,
      priceCad: i.priceCad,
      msrpCad: i.comparison?.msrpCad ?? null,
      diffPct: i.comparison?.diffPct ?? null,
      tier: i.comparison?.tier ?? null,
      basis: i.comparison?.reference.basis ?? null,
      confidence: i.match.confidence,
    });
    const compared = items.filter((i) => i.state === 'compared');
    const official = compared.filter((i) => i.comparison!.reference.basis !== 'derived_benchmark' && i.match.status === 'matched');
    const best = official.filter((i) => i.comparison!.diffPct < 0).sort((a, b) => a.comparison!.diffPct - b.comparison!.diffPct)[0];
    const n = this.state.settings.thresholds.neutralBand;
    return {
      retailer: this.adapter.name,
      url: this.win.location.href,
      total: items.length,
      below: compared.filter((i) => i.comparison!.diffPct <= -n).length,
      above: compared.filter((i) => i.comparison!.diffPct >= n).length,
      atMsrp: compared.filter((i) => Math.abs(i.comparison!.diffPct) < n).length,
      unavailable: items.filter((i) => ['msrp_unavailable', 'legacy', 'benchmark_hidden'].includes(i.state)).length,
      uncertain: items.filter((i) => i.state === 'uncertain').length,
      bestDeal: best ? toSummary(best) : null,
      items: items.map(toSummary),
    };
  }

  /** Scroll to a product and briefly highlight it (from the popup list). */
  reveal(key: string) {
    const t = this.tracked.get(key);
    if (!t) return false;
    t.detected.root.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const el = t.detected.root as HTMLElement;
    const prev = el.style.outline;
    el.style.outline = '3px solid #1f6feb';
    el.style.outlineOffset = '2px';
    setTimeout(() => {
      el.style.outline = prev;
    }, 1800);
    if (t.host && !t.host.hidden) setTimeout(() => this.openPopover(key, t.host!), 450);
    return true;
  }

  openPopover(key: string, _host: BadgeHost) {
    this.openKey = key;
    this.renderPopover();
  }

  closePopover() {
    this.openKey = null;
    this.overlay?.root.render(null);
  }

  private renderPopover() {
    const t = this.openKey ? this.tracked.get(this.openKey) : null;
    if (!t || !t.host) return this.closePopover();
    if (!this.overlay) {
      const host = this.doc.createElement(OVERLAY_TAG);
      const shadow = host.attachShadow({ mode: 'open' });
      const style = this.doc.createElement('style');
      style.textContent = POPOVER_CSS;
      const mount = this.doc.createElement('div');
      shadow.append(style, mount);
      this.doc.documentElement.appendChild(host);
      this.overlay = { host, root: createRoot(mount) };
    }
    const key = t.item.key;
    this.overlay.root.render(
      createElement(Popover, {
        key,
        item: t.item,
        anchor: t.host,
        db: this.state.db,
        fx: this.state.fx,
        displayCurrency: this.state.settings.displayCurrency,
        onClose: () => {
          this.closePopover();
          t.host?.shadowRoot?.querySelector('button')?.focus();
        },
        onSelect: async (productId) => {
          const mk = mappingKey(t.detected.listing);
          await this.deps.saveMapping(mk, productId);
          const mappings = { ...this.state.mappings };
          if (productId) mappings[mk] = productId;
          else delete mappings[mk];
          this.state = { ...this.state, mappings };
          this.scan(true);
        },
      }),
    );
  }
}
