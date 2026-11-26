import type { RetailerAdapter } from './common';
import { amazonAdapter, ebGamesAdapter, fourOhOneAdapter } from './others';
import { walmartAdapter } from './walmart';

/**
 * Retailer adapters are independent: adding a store means writing one adapter
 * (find cards, extract title/price/IDs, choose an injection point), registering it
 * here and adding its host to `content.matches` in entrypoints/content.ts.
 */
export const ADAPTERS: RetailerAdapter[] = [walmartAdapter, amazonAdapter, ebGamesAdapter, fourOhOneAdapter];

export function adapterFor(hostname: string): RetailerAdapter | null {
  return ADAPTERS.find((a) => a.hostnames.test(hostname)) ?? null;
}
