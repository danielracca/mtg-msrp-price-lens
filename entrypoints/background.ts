import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { validateDatabase } from '../src/core/dbValidate';
import { BOC_URL, needsRefresh, parseBankOfCanada } from '../src/core/fx';
import type { ExchangeRate, ProductDatabase } from '../src/core/types';
import type { Message, RefreshResult } from '../src/shared/messages';
import { BUNDLED_DB, KEYS, loadSettings } from '../src/shared/store';

const ALARM = 'mtgpl-fx-check';
let inflight: Promise<RefreshResult> | null = null;

/** Fetch the latest USD→CAD rate from the Bank of Canada Valet API (free, no key). */
async function refreshFx(force = false): Promise<RefreshResult> {
  if (inflight) return inflight; // collapse concurrent requests
  inflight = (async () => {
    const r = await browser.storage.local.get(KEYS.fx);
    const cached = r[KEYS.fx] as ExchangeRate | undefined;
    if (!force && !needsRefresh(cached, Date.now())) return { ok: true, message: 'Exchange rate is up to date' };
    try {
      const res = await fetch(BOC_URL, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { rate, observationDate } = parseBankOfCanada(await res.json());
      const fx: ExchangeRate = { rate, observationDate, fetchedAt: Date.now(), source: 'bank_of_canada' };
      await browser.storage.local.set({ [KEYS.fx]: fx, [KEYS.fxError]: null });
      return { ok: true, message: `1 USD = ${rate.toFixed(4)} CAD (${observationDate})` };
    } catch (e) {
      const message = (e as Error).message || 'Network error';
      // Keep the last good rate; record the error so the UI can disclose staleness.
      await browser.storage.local.set({ [KEYS.fxError]: message });
      return { ok: false, message: `Could not refresh: ${message}. Using last known rate.` };
    }
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

/**
 * Product database refresh. Without a remote URL this re-installs the bundled database.
 * With a remote URL (future hosted updates) the JSON is validated before it is used.
 */
async function refreshDb(): Promise<RefreshResult> {
  const settings = await loadSettings();
  if (!settings.remoteDbUrl) {
    await browser.storage.local.remove(KEYS.dbOverride);
    await browser.storage.local.set({ [KEYS.dbStatus]: { checkedAt: Date.now(), version: BUNDLED_DB.dbVersion, source: 'bundled' } });
    return { ok: true, message: `Using bundled database v${BUNDLED_DB.dbVersion} (${BUNDLED_DB.products.length} products)` };
  }
  try {
    const url = new URL(settings.remoteDbUrl);
    if (url.protocol !== 'https:') throw new Error('Remote database URL must use https');
    const res = await fetch(url.href, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const db = (await res.json()) as ProductDatabase;
    const errors = validateDatabase(db).filter((i) => i.level === 'error');
    if (errors.length) throw new Error(`Remote database failed validation (${errors.length} errors)`);
    if (db.dbVersion <= BUNDLED_DB.dbVersion) {
      await browser.storage.local.remove(KEYS.dbOverride);
      return { ok: true, message: `Remote v${db.dbVersion} is not newer than bundled v${BUNDLED_DB.dbVersion}` };
    }
    await browser.storage.local.set({ [KEYS.dbOverride]: db, [KEYS.dbStatus]: { checkedAt: Date.now(), version: db.dbVersion, source: 'remote' } });
    return { ok: true, message: `Installed database v${db.dbVersion} (${db.products.length} products)` };
  } catch (e) {
    return { ok: false, message: `Database refresh failed: ${(e as Error).message}` };
  }
}

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(() => {
    browser.alarms.create(ALARM, { periodInMinutes: 360 });
    void refreshFx();
  });
  browser.runtime.onStartup.addListener(() => void refreshFx());
  browser.alarms.onAlarm.addListener((a) => {
    if (a.name === ALARM) void refreshFx();
  });
  browser.runtime.onMessage.addListener((msg: Message, _sender, sendResponse) => {
    if (msg.type === 'MTGPL_REFRESH_FX') {
      refreshFx(true).then(sendResponse);
      return true;
    }
    if (msg.type === 'MTGPL_REFRESH_DB') {
      refreshDb().then(sendResponse);
      return true;
    }
    return undefined;
  });
});
