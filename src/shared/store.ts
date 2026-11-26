import { browser } from 'wxt/browser';
import bundledDb from '../../data/products.json';
import { type EffectiveRate, effectiveRate } from '../core/fx';
import { mergeSettings, type Settings } from '../core/settings';
import type { ExchangeRate, ProductDatabase } from '../core/types';

/** chrome.storage.local keys. Everything stays on the device; no accounts, no analytics. */
export const KEYS = {
  settings: 'settings',
  fx: 'fxCache',
  fxError: 'fxLastError',
  mappings: 'manualMappings',
  dbOverride: 'dbOverride',
  dbStatus: 'dbStatus',
} as const;

export const BUNDLED_DB = bundledDb as ProductDatabase;

export async function loadSettings(): Promise<Settings> {
  const r = await browser.storage.local.get(KEYS.settings);
  return mergeSettings(r[KEYS.settings] as Partial<Settings> | undefined);
}

export async function saveSettings(s: Settings): Promise<void> {
  await browser.storage.local.set({ [KEYS.settings]: s });
}

/** Remote/updated DB if one was installed and is newer than the bundled DB. */
export async function loadDb(): Promise<ProductDatabase> {
  const r = await browser.storage.local.get(KEYS.dbOverride);
  const o = r[KEYS.dbOverride] as ProductDatabase | undefined;
  if (o && o.schemaVersion === 1 && o.dbVersion > BUNDLED_DB.dbVersion) return o;
  return BUNDLED_DB;
}

export async function loadFx(settings: Settings): Promise<EffectiveRate> {
  const r = await browser.storage.local.get([KEYS.fx, KEYS.fxError]);
  return effectiveRate(r[KEYS.fx] as ExchangeRate | undefined, settings.customRate, Date.now(), r[KEYS.fxError] as string | undefined);
}

export async function loadMappings(): Promise<Record<string, string>> {
  const r = await browser.storage.local.get(KEYS.mappings);
  return (r[KEYS.mappings] as Record<string, string> | undefined) ?? {};
}

export async function saveMapping(key: string, productId: string | null): Promise<void> {
  const m = await loadMappings();
  if (productId) m[key] = productId;
  else delete m[key];
  await browser.storage.local.set({ [KEYS.mappings]: m });
}
