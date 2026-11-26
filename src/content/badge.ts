import { BADGE_TAG } from '../adapters/common';
import { type BadgeView, badgeView } from '../shared/format';
import type { PageItem } from './evaluate';

/**
 * Badge: a tiny custom element with its own Shadow DOM so retailer CSS cannot
 * affect it (and ours cannot leak). One badge per product card, keyed by item key.
 */
export const BADGE_CSS = `
:host { all: initial; display: block; margin: 4px 0 2px; min-height: 22px; line-height: 1; contain: layout style; }
:host([hidden]) { display: none; }
button {
  all: unset; box-sizing: border-box; cursor: pointer; display: inline-flex; align-items: center; gap: 5px;
  height: 22px; padding: 0 8px; border-radius: 999px; max-width: 100%;
  font: 600 12px/1 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; letter-spacing: .01em;
  border: 1px solid transparent; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
button:focus-visible { outline: 2px solid #1d4ed8; outline-offset: 2px; }
.icon { font-size: 10px; }
.lens { font-weight: 700; opacity: .85; font-size: 10px; text-transform: uppercase; letter-spacing: .04em; }
.t-great { background: #0b5d1e; color: #fff; }
.t-good { background: #e3f4e6; color: #0f5223; border-color: #9dd3a8; }
.t-neutral { background: #f1f3f5; color: #212529; border-color: #ced4da; }
.t-high { background: #fff1e5; color: #8a3500; border-color: #f5b37a; }
.t-very_high { background: #b42318; color: #fff; }
.t-muted { background: #f8f9fa; color: #495057; border-color: #dee2e6; }
.t-uncertain { background: #fff; color: #495057; border: 1px dashed #868e96; }
.est { border-style: dashed; }
.t-great.est, .t-very_high.est { outline: 1px dashed currentColor; outline-offset: -3px; }
`;

export interface BadgeHost extends HTMLElement {
  __mtgplKey?: string;
  __mtgplSig?: string;
}

export function findBadge(root: Element, key: string): BadgeHost | null {
  for (const el of Array.from(root.querySelectorAll<BadgeHost>(BADGE_TAG))) if (el.__mtgplKey === key || el.dataset.key === key) return el;
  return null;
}

export function renderBadge(anchor: Element, item: PageItem, visible: boolean, onClick: (host: BadgeHost) => void): BadgeHost {
  const scope = anchor.parentElement ?? anchor;
  let host = findBadge(scope, item.key) ?? (anchor.nextElementSibling?.tagName.toLowerCase() === BADGE_TAG ? (anchor.nextElementSibling as BadgeHost) : null);
  const view = badgeView(item);
  const sig = `${view.tone}|${view.text}|${view.estimated}`;
  if (!host) {
    host = document.createElement(BADGE_TAG) as BadgeHost;
    host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = BADGE_CSS;
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('aria-haspopup', 'dialog');
    button.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation(); // never trigger the retailer's card link
      onClick(host!);
    });
    // Product cards are often wrapped in links; swallow pointer events so they don't navigate.
    for (const ev of ['mousedown', 'mouseup', 'pointerdown'] as const) button.addEventListener(ev, (e) => e.stopPropagation());
    host.shadowRoot!.append(style, button);
    anchor.insertAdjacentElement('afterend', host);
  }
  host.__mtgplKey = item.key;
  host.dataset.key = item.key;
  host.dataset.state = item.state;
  host.hidden = !visible;
  if (host.__mtgplSig !== sig) {
    host.__mtgplSig = sig;
    paint(host, view);
  }
  return host;
}

function paint(host: BadgeHost, view: BadgeView) {
  const button = host.shadowRoot!.querySelector('button')!;
  button.className = `t-${view.tone}${view.estimated ? ' est' : ''}`;
  button.setAttribute('aria-label', view.aria);
  button.title = view.aria;
  button.replaceChildren();
  const icon = document.createElement('span');
  icon.className = 'icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = view.icon;
  const text = document.createElement('span');
  text.textContent = view.text;
  button.append(icon, text);
}
