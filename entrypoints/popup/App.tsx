import { useCallback, useEffect, useMemo, useState } from 'react';
import { browser } from 'wxt/browser';
import type { EffectiveRate } from '../../src/core/fx';
import { DEFAULT_SETTINGS, type Settings } from '../../src/core/settings';
import type { ProductDatabase } from '../../src/core/types';
import { formatDate } from '../../src/shared/format';
import type { Message, PageSummary, RefreshResult, SummaryItem } from '../../src/shared/messages';
import { KEYS, loadDb, loadFx, loadSettings, saveSettings } from '../../src/shared/store';

type Sort = 'discount' | 'price' | 'page';
const SUPPORTED = 'Walmart.ca, Amazon.ca, EB Games or 401 Games';

export function App() {
  const [tab, setTab] = useState<'page' | 'settings'>('page');
  const [summary, setSummary] = useState<PageSummary | null | 'unsupported'>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [fx, setFx] = useState<EffectiveRate | null>(null);
  const [db, setDb] = useState<ProductDatabase | null>(null);
  const [tabId, setTabId] = useState<number | null>(null);

  const loadAll = useCallback(async () => {
    const s = await loadSettings();
    setSettings(s);
    setFx(await loadFx(s));
    setDb(await loadDb());
  }, []);

  const loadSummary = useCallback(async (id: number | null) => {
    if (id == null) return setSummary('unsupported');
    try {
      const res = (await browser.tabs.sendMessage(id, { type: 'MTGPL_GET_SUMMARY' } satisfies Message)) as PageSummary | undefined;
      setSummary(res ?? 'unsupported');
    } catch {
      setSummary('unsupported');
    }
  }, []);

  useEffect(() => {
    void loadAll();
    // `?tabId=` lets automated tests open the popup as a page targeting a given tab.
    const forced = Number(new URLSearchParams(location.search).get('tabId')) || null;
    void (forced ? Promise.resolve([{ id: forced }]) : browser.tabs.query({ active: true, currentWindow: true })).then(([t]) => {
      setTabId(t?.id ?? null);
      void loadSummary(t?.id ?? null);
    });
    const onChange = () => {
      void loadAll();
      setTimeout(() => void loadSummary(tabId), 150);
    };
    browser.storage.onChanged.addListener(onChange);
    return () => browser.storage.onChanged.removeListener(onChange);
  }, [loadAll, loadSummary, tabId]);

  return (
    <div className="app">
      <header>
        <div className="logo" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="22" height="22"><circle cx="10" cy="10" r="6.5" fill="none" stroke="currentColor" strokeWidth="2.2" /><path d="M15 15l5 5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" /><path d="M7.5 11.5l2-3 2 3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /></svg>
        </div>
        <div>
          <h1>MTG Price Lens</h1>
          <p className="muted">Sealed Magic prices vs official MSRP</p>
        </div>
      </header>
      <nav role="tablist">
        <button role="tab" aria-selected={tab === 'page'} onClick={() => setTab('page')}>This page</button>
        <button role="tab" aria-selected={tab === 'settings'} onClick={() => setTab('settings')}>Settings</button>
      </nav>
      {tab === 'page' ? (
        <PageTab summary={summary} settings={settings} tabId={tabId} />
      ) : (
        <SettingsTab settings={settings} onChange={async (s) => { setSettings(s); await saveSettings(s); }} />
      )}
      <Footer fx={fx} db={db} />
    </div>
  );
}

function PageTab({ summary, settings, tabId }: { summary: PageSummary | null | 'unsupported'; settings: Settings; tabId: number | null }) {
  const [sort, setSort] = useState<Sort>('discount');
  const items = useMemo(() => {
    if (!summary || summary === 'unsupported') return [];
    const list = [...summary.items];
    if (sort === 'discount') list.sort((a, b) => (a.diffPct ?? Infinity) - (b.diffPct ?? Infinity));
    if (sort === 'price') list.sort((a, b) => (a.priceCad ?? Infinity) - (b.priceCad ?? Infinity));
    return list;
  }, [summary, sort]);

  if (summary === null) return <div className="empty">Scanning page…</div>;
  if (summary === 'unsupported') {
    return (
      <div className="empty">
        <p><b>No supported store on this tab.</b></p>
        <p className="muted">Open {SUPPORTED} and search for “Magic the Gathering”. Badges appear under each sealed product's price.</p>
      </div>
    );
  }
  const reveal = (key: string) => tabId != null && void browser.tabs.sendMessage(tabId, { type: 'MTGPL_REVEAL', key } satisfies Message);
  const deals = summary.items.filter((i) => (i.tier === 'great' || i.tier === 'good') && i.diffPct! <= -settings.minDiscountPct).length;

  return (
    <section aria-label="Page summary">
      <div className="stats">
        <Stat n={summary.total} label="Detected" />
        <Stat n={summary.below} label="Below MSRP" tone="good" />
        <Stat n={summary.above} label="Above MSRP" tone="bad" />
        <Stat n={summary.unavailable} label="No MSRP" />
        <Stat n={summary.uncertain} label="Uncertain" />
      </div>

      {summary.bestDeal ? (
        <button className="best" onClick={() => reveal(summary.bestDeal!.key)}>
          <span className="eyebrow">Best verified deal on this page</span>
          <span className="best-name">{summary.bestDeal.productName}</span>
          <span className="best-num">
            <b>{Math.abs(summary.bestDeal.diffPct!).toFixed(1)}% below MSRP</b> · ${summary.bestDeal.priceCad?.toFixed(2)} vs est. ${summary.bestDeal.msrpCad?.toFixed(2)} CAD
          </span>
        </button>
      ) : (
        <div className="best none">No verified below-MSRP deal found on this page{summary.total === 0 ? ' — scroll to load products' : ''}.</div>
      )}

      {items.length > 0 && (
        <>
          <div className="listhead">
            <span className="muted">{summary.retailer} · {deals} deal{deals === 1 ? '' : 's'}{settings.minDiscountPct > 0 ? ` ≥ ${settings.minDiscountPct}% off` : ''}</span>
            <label>
              Sort{' '}
              <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                <option value="discount">% below MSRP</option>
                <option value="price">Price</option>
                <option value="page">Page order</option>
              </select>
            </label>
          </div>
          <ul className="list">
            {items.map((i) => <Row key={i.key} i={i} onClick={() => reveal(i.key)} />)}
          </ul>
        </>
      )}
    </section>
  );
}

function Row({ i, onClick }: { i: SummaryItem; onClick: () => void }) {
  const est = i.basis === 'derived_benchmark';
  const label =
    i.state === 'compared' && i.diffPct != null
      ? `${i.diffPct < 0 ? '▼' : i.tier === 'neutral' ? '●' : '▲'} ${Math.floor(Math.abs(i.diffPct) + 1e-9)}%`
      : i.state === 'uncertain' ? '? match' : '○ n/a';
  return (
    <li>
      <button onClick={onClick} title={i.title}>
        <span className={`pill t-${i.tier ?? (i.state === 'uncertain' ? 'uncertain' : 'muted')}${est ? ' est' : ''}`}>{label}</span>
        <span className="rowtext">
          <span className="name">{i.productName ?? i.title}</span>
          <span className="muted small">
            {i.priceCad != null ? `$${i.priceCad.toFixed(2)}` : 'no price'}
            {i.msrpCad != null ? ` · ${est ? 'benchmark' : 'est. MSRP'} $${i.msrpCad.toFixed(2)}` : ''}
            {i.state === 'legacy' || i.state === 'msrp_unavailable' ? ' · no official MSRP' : ''}
          </span>
        </span>
      </button>
    </li>
  );
}

function Stat({ n, label, tone }: { n: number; label: string; tone?: 'good' | 'bad' }) {
  return (
    <div className={`stat ${tone ?? ''}`}>
      <b>{n}</b>
      <span>{label}</span>
    </div>
  );
}

function SettingsTab({ settings, onChange }: { settings: Settings; onChange: (s: Settings) => void }) {
  const [status, setStatus] = useState<string>('');
  const [rateText, setRateText] = useState(settings.customRate?.toString() ?? '');
  const [dbUrl, setDbUrl] = useState(settings.remoteDbUrl);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => onChange({ ...settings, [k]: v });

  const refresh = async (type: 'MTGPL_REFRESH_FX' | 'MTGPL_REFRESH_DB') => {
    setStatus('Working…');
    const r = (await browser.runtime.sendMessage({ type } satisfies Message)) as RefreshResult;
    setStatus(r?.message ?? 'Done');
  };

  const saveDbUrl = async () => {
    if (dbUrl) {
      try {
        const u = new URL(dbUrl);
        if (u.protocol !== 'https:') return setStatus('Database URL must start with https://');
        const granted = await browser.permissions.request({ origins: [`${u.origin}/*`] });
        if (!granted) return setStatus('Permission to access that host was not granted.');
      } catch {
        return setStatus('Invalid URL');
      }
    }
    set('remoteDbUrl', dbUrl);
    setStatus(dbUrl ? 'Saved. Use “Refresh product database” to download it.' : 'Remote database disabled.');
  };

  return (
    <section className="settings" aria-label="Settings">
      <Toggle label="Show price badges automatically" checked={settings.badgesEnabled} onChange={(v) => set('badgesEnabled', v)} />
      <Toggle label="Show only products below MSRP" checked={settings.showOnlyBelowMsrp} onChange={(v) => set('showOnlyBelowMsrp', v)} />
      <Toggle label="Show estimated benchmarks (e.g. booster box = packs × pack MSRP)" checked={settings.showEstimatedBenchmarks} onChange={(v) => set('showEstimatedBenchmarks', v)} />
      <div className="field">
        <label htmlFor="min">Minimum discount to count as a deal</label>
        <span className="inline"><input id="min" type="number" min={0} max={90} step={1} value={settings.minDiscountPct} onChange={(e) => set('minDiscountPct', Math.max(0, Number(e.target.value) || 0))} />%</span>
      </div>
      <div className="field">
        <label htmlFor="cur">Display currency</label>
        <select id="cur" value={settings.displayCurrency} onChange={(e) => set('displayCurrency', e.target.value as Settings['displayCurrency'])}>
          <option value="CAD">CAD</option>
          <option value="CAD_USD">CAD + USD</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor="rate">Custom exchange rate (CAD per USD)</label>
        <span className="inline">
          <input id="rate" type="number" step="0.0001" min={0.5} max={3} placeholder="Auto (Bank of Canada)" value={rateText} onChange={(e) => setRateText(e.target.value)} onBlur={() => { const n = Number(rateText); set('customRate', rateText && n > 0.5 && n < 3 ? n : null); if (!rateText) setRateText(''); }} />
        </span>
      </div>
      <details>
        <summary>Price thresholds</summary>
        {(['greatDeal', 'neutralBand', 'highMarkup'] as const).map((k) => (
          <div className="field" key={k}>
            <label htmlFor={k}>{k === 'greatDeal' ? 'Dark green at ≥ % below' : k === 'neutralBand' ? '“At MSRP” within ±%' : 'Red at ≥ % above'}</label>
            <span className="inline"><input id={k} type="number" min={1} max={90} value={settings.thresholds[k]} onChange={(e) => onChange({ ...settings, thresholds: { ...settings.thresholds, [k]: Math.max(1, Number(e.target.value) || 1) } })} />%</span>
          </div>
        ))}
      </details>
      <details>
        <summary>Remote database (optional)</summary>
        <p className="muted small">Point to a hosted products.json generated by the database CLI. It is validated before use. Leave empty to use the bundled database.</p>
        <div className="inline"><input type="url" placeholder="https://…/products.json" value={dbUrl} onChange={(e) => setDbUrl(e.target.value)} /><button className="ghost" onClick={saveDbUrl}>Save</button></div>
      </details>
      <div className="buttons">
        <button onClick={() => refresh('MTGPL_REFRESH_DB')}>Refresh product database</button>
        <button onClick={() => refresh('MTGPL_REFRESH_FX')}>Refresh exchange rate</button>
      </div>
      {status && <p className="status" role="status">{status}</p>}
      <p className="muted small">Comparisons use the listed pre-tax item price, excluding shipping. Manual product corrections are stored only on this device.</p>
      <button className="ghost small" onClick={async () => { await browser.storage.local.remove(KEYS.mappings); setStatus('Manual corrections cleared.'); }}>Clear manual corrections</button>
    </section>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="toggle">
      <span>{label}</span>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

function Footer({ fx, db }: { fx: EffectiveRate | null; db: ProductDatabase | null }) {
  return (
    <footer>
      <div>
        <span className="muted">Exchange rate</span>{' '}
        {fx ? (
          <>
            <b>1 USD = {fx.rate.toFixed(4)} CAD</b>{' '}
            <span className="muted">· {fx.source === 'custom' ? 'custom' : fx.source === 'bank_of_canada' ? `Bank of Canada, ${formatDate(fx.observationDate)}` : `bundled, ${formatDate(fx.observationDate)}`}</span>
            {fx.stale && <div className="warn">⚠ {fx.staleReason}</div>}
          </>
        ) : '—'}
      </div>
      <div>
        <span className="muted">MSRP database</span> <b>v{db?.dbVersion ?? '—'}</b> <span className="muted">· updated {formatDate(db?.generatedAt)} · {db?.products.length ?? 0} products</span>
      </div>
    </footer>
  );
}
