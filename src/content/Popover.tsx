import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { EffectiveRate } from '../core/fx';
import type { ProductDatabase, ProductRecord } from '../core/types';
import { cad, formatDate, signedCad, usd } from '../shared/format';
import { IGNORE_MAPPING, type PageItem, productTypeLabel } from './evaluate';

export interface PopoverProps {
  item: PageItem;
  anchor: HTMLElement;
  db: ProductDatabase;
  fx: EffectiveRate | null;
  displayCurrency: 'CAD' | 'CAD_USD';
  onSelect: (productId: string | null) => void;
  onClose: () => void;
}

export const POPOVER_CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.pop {
  position: fixed; z-index: 2147483646; width: 340px; max-width: calc(100vw - 16px); max-height: min(560px, calc(100vh - 16px)); overflow: auto;
  background: #fff; color: #1f2328; border: 1px solid #d0d7de; border-radius: 12px; box-shadow: 0 12px 32px rgba(15,23,42,.18), 0 2px 6px rgba(15,23,42,.08);
  font: 13px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; padding: 14px 16px 12px;
}
.hd { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
.brand { font-size: 10px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: #59636e; }
h2 { font-size: 15px; line-height: 1.3; margin: 2px 0 2px; font-weight: 650; }
.sub { color: #59636e; font-size: 12px; }
.x { all: unset; cursor: pointer; width: 26px; height: 26px; border-radius: 6px; display: grid; place-items: center; color: #59636e; font-size: 16px; flex: none; }
.x:hover { background: #f3f4f6; } .x:focus-visible, button:focus-visible, a:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid #1d4ed8; outline-offset: 2px; }
.verdict { display: flex; align-items: baseline; gap: 8px; padding: 10px 12px; border-radius: 10px; margin: 10px 0; }
.verdict .big { font-size: 22px; font-weight: 750; letter-spacing: -.01em; }
.v-great { background: #0b5d1e; color: #fff; } .v-good { background: #e3f4e6; color: #0f5223; }
.v-neutral { background: #f1f3f5; color: #212529; } .v-high { background: #fff1e5; color: #8a3500; } .v-very_high { background: #b42318; color: #fff; }
dl { display: grid; grid-template-columns: auto 1fr; gap: 5px 12px; margin: 0; }
dt { color: #59636e; } dd { margin: 0; text-align: right; font-variant-numeric: tabular-nums; font-weight: 550; }
.tag { display: inline-block; font-size: 10.5px; font-weight: 700; padding: 2px 6px; border-radius: 4px; vertical-align: 1px; }
.tag-official { background: #ddf4ff; color: #0a3069; } .tag-est { background: #fff8c5; color: #4d2d00; border: 1px dashed #bf8700; }
.note { font-size: 11.5px; color: #59636e; margin: 10px 0 0; }
.warn { font-size: 12px; background: #fff8c5; color: #4d2d00; border-radius: 8px; padding: 7px 9px; margin-top: 10px; }
.sec { border-top: 1px solid #eaeef2; margin-top: 12px; padding-top: 10px; }
a { color: #0969da; }
.row { display: flex; gap: 8px; align-items: center; justify-content: space-between; flex-wrap: wrap; }
.linkbtn { all: unset; cursor: pointer; color: #0969da; font-size: 12px; text-decoration: underline; }
input[type=search] { width: 100%; font: inherit; padding: 6px 8px; border: 1px solid #d0d7de; border-radius: 6px; margin: 6px 0; }
ul { list-style: none; margin: 0; padding: 0; max-height: 180px; overflow: auto; border: 1px solid #eaeef2; border-radius: 6px; }
li button { all: unset; display: block; width: 100%; padding: 6px 8px; cursor: pointer; font-size: 12px; box-sizing: border-box; }
li button:hover, li button:focus-visible { background: #f6f8fa; }
li .m { color: #59636e; font-size: 11px; }
.conf { display: inline-flex; align-items: center; gap: 6px; }
.bar { width: 60px; height: 6px; border-radius: 3px; background: #eaeef2; overflow: hidden; }
.bar i { display: block; height: 100%; background: #1f6feb; }
`;

const BASIS_TEXT = {
  official_cad: 'Official CAD MSRP',
  official_usd_converted: 'Estimated CAD MSRP',
  derived_benchmark: 'Estimated benchmark',
} as const;

function usePosition(anchor: HTMLElement, ref: React.RefObject<HTMLDivElement | null>) {
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: -9999, left: -9999 });
  useLayoutEffect(() => {
    const place = () => {
      const r = anchor.getBoundingClientRect();
      const el = ref.current;
      const w = el?.offsetWidth ?? 340;
      const h = el?.offsetHeight ?? 300;
      let top = r.bottom + 6;
      if (top + h > window.innerHeight - 8 && r.top - h - 6 > 8) top = r.top - h - 6;
      const left = Math.min(Math.max(8, r.left), window.innerWidth - w - 8);
      setPos({ top: Math.max(8, top), left });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [anchor, ref]);
  return pos;
}

export function Popover({ item, anchor, db, fx, displayCurrency, onSelect, onClose }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const pos = usePosition(anchor, ref);
  const [picking, setPicking] = useState(item.state === 'uncertain');

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('.x')?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    const onDown = (e: MouseEvent) => {
      const path = e.composedPath();
      if (!path.includes(ref.current as EventTarget) && !path.includes(anchor)) onClose();
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('mousedown', onDown, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('mousedown', onDown, true);
    };
  }, [anchor, onClose]);

  const p = item.product;
  const c = item.comparison;
  const set = p ? db.sets.find((s) => s.code === p.setCode) : null;

  return (
    <div className="pop" role="dialog" aria-label="MTG Price Lens price comparison" ref={ref} style={{ top: pos.top, left: pos.left }}>
      <div className="hd">
        <div>
          <div className="brand">MTG Price Lens</div>
          <h2>{p ? p.name : item.state === 'legacy' ? 'No official MSRP' : 'Product match uncertain'}</h2>
          {p && (
            <div className="sub">
              {set?.name ?? p.setName} · {productTypeLabel(p)}
              {item.match.quantity > 1 ? ` · ×${item.match.quantity}` : ''}
            </div>
          )}
        </div>
        <button className="x" aria-label="Close" onClick={onClose}>✕</button>
      </div>

      {c && (
        <div className={`verdict v-${c.tier}`}>
          <span className="big">{c.tier === 'neutral' ? 'At' : `${Math.abs(c.diffPct).toFixed(1)}%`}</span>
          <span>
            {c.tier === 'neutral' ? `${c.reference.basis === 'derived_benchmark' ? 'benchmark' : 'MSRP'} (${c.diffPct >= 0 ? '+' : '−'}${Math.abs(c.diffPct).toFixed(1)}%)` : `${c.diffPct < 0 ? 'below' : 'above'} ${c.reference.basis === 'derived_benchmark' ? 'estimated benchmark' : 'MSRP'}`} · {signedCad(c.diffAmountCad)}
          </span>
        </div>
      )}

      {c && p && (
        <dl>
          <dt>Retailer price</dt>
          <dd>{cad(c.priceCad)}</dd>
          <dt>{c.reference.basis === 'derived_benchmark' ? 'Benchmark (USD)' : 'Official MSRP (USD)'}</dt>
          <dd>
            {c.reference.usd != null ? usd(c.reference.usd) : '—'}{' '}
            <span className={`tag ${c.reference.basis === 'derived_benchmark' ? 'tag-est' : 'tag-official'}`}>{c.reference.basis === 'derived_benchmark' ? 'ESTIMATE' : 'OFFICIAL'}</span>
          </dd>
          <dt>{BASIS_TEXT[c.reference.basis]}</dt>
          <dd>{cad(c.msrpCad)}</dd>
          <dt>Difference</dt>
          <dd>
            {c.diffPct >= 0 ? '+' : '−'}
            {Math.abs(c.diffPct).toFixed(1)}% ({signedCad(c.diffAmountCad)})
          </dd>
          {c.rateUsed != null && (
            <>
              <dt>Exchange rate</dt>
              <dd>1 USD = {c.rateUsed.toFixed(4)} CAD</dd>
              <dt>Rate updated</dt>
              <dd>
                {fx ? formatDate(fx.observationDate) : '—'}
                {fx?.source === 'custom' ? ' (custom)' : fx?.source === 'bank_of_canada' ? ' · Bank of Canada' : ''}
              </dd>
            </>
          )}
          {displayCurrency === 'CAD_USD' && fx && (
            <>
              <dt>Retailer price (USD)</dt>
              <dd>{usd(c.priceCad / fx.rate)}</dd>
            </>
          )}
          <dt>Match confidence</dt>
          <dd>
            <span className="conf">
              <span className="bar" aria-hidden="true"><i style={{ width: `${Math.round(item.match.confidence * 100)}%` }} /></span>
              {Math.round(item.match.confidence * 100)}%{item.manual ? ' (manual)' : item.match.method === 'upc' ? ' (UPC)' : ''}
            </span>
          </dd>
        </dl>
      )}

      {c?.reference.derivationLabel && <p className="note"><b>{c.reference.derivationLabel}.</b> Wizards did not publish an official MSRP for this exact product; this is not an official price.</p>}
      {c && c.reference.basis === 'official_usd_converted' && (
        <p className="note">Wizards publishes MSRPs in USD. The CAD figure is a currency conversion, not an official Canadian price. Compares the listed pre-tax item price; shipping and taxes excluded.</p>
      )}
      {fx?.stale && c?.rateUsed != null && <div className="warn" role="note">⚠ Stale exchange rate: {fx.staleReason}</div>}

      {!c && p && (item.state === 'msrp_unavailable' || item.state === 'benchmark_hidden') && (
        <p className="note">{item.state === 'benchmark_hidden' ? 'Only an estimated benchmark exists for this product. Enable “Show estimated benchmarks” in the extension settings to see it.' : p.msrp.note ?? 'Wizards of the Coast did not publish an official MSRP for this product.'}</p>
      )}
      {item.state === 'no_price' && <p className="note">The current selling price could not be read from this listing.</p>}
      {item.state === 'legacy' && <p className="note">{item.explanation[0]}</p>}
      {item.state === 'uncertain' && (
        <p className="note">To avoid showing a wrong comparison, no price is compared until the product is identified. {item.explanation.slice(-1)[0]}</p>
      )}

      {p?.msrp.sourceUrl && (
        <div className="sec row">
          <a href={p.msrp.sourceUrl} target="_blank" rel="noopener noreferrer">
            Official MSRP source ↗
          </a>
          <span className="sub">Published {formatDate(p.msrp.sourcePublishedDate)}</span>
        </div>
      )}

      <div className="sec">
        {!picking ? (
          <div className="row">
            <span className="sub">Wrong product?</span>
            <button className="linkbtn" onClick={() => setPicking(true)}>Choose manually</button>
          </div>
        ) : (
          <ProductPicker item={item} db={db} onSelect={onSelect} />
        )}
      </div>
    </div>
  );
}

function ProductPicker({ item, db, onSelect }: { item: PageItem; db: ProductDatabase; onSelect: (id: string | null) => void }) {
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    const pool: ProductRecord[] = q ? db.products : item.match.candidates.length ? item.match.candidates : db.products;
    return pool.filter((p) => terms.every((t) => `${p.name} ${p.setCode} ${p.aliases.join(' ')}`.toLowerCase().includes(t))).slice(0, 60);
  }, [q, db, item]);
  return (
    <div>
      <label className="sub" htmlFor="mtgpl-search">Select the correct product (remembered on this device)</label>
      <input id="mtgpl-search" type="search" placeholder="Search e.g. “Tarkir collector box”" value={q} onChange={(e) => setQ(e.target.value)} />
      <ul aria-label="Products">
        {list.map((p) => (
          <li key={p.id}>
            <button onClick={() => onSelect(p.id)}>
              {p.name}
              <div className="m">{p.msrp.classification === 'official' ? `Official MSRP $${p.msrp.usd?.toFixed(2)} USD` : p.msrp.classification === 'derived' ? 'Estimated benchmark only' : 'MSRP unavailable'}</div>
            </button>
          </li>
        ))}
        {list.length === 0 && <li className="m" style={{ padding: 8 }}>No products found.</li>}
      </ul>
      <div className="row" style={{ marginTop: 8 }}>
        <button className="linkbtn" onClick={() => onSelect(IGNORE_MAPPING)}>Not a sealed MTG product</button>
        {item.manual && <button className="linkbtn" onClick={() => onSelect(null)}>Reset to automatic</button>}
      </div>
    </div>
  );
}
