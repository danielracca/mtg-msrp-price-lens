import { browser } from 'wxt/browser';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { adapterFor } from '../src/adapters/registry';
import { PageController } from '../src/content/controller';
import type { Message } from '../src/shared/messages';
import { KEYS, loadDb, loadFx, loadMappings, loadSettings, saveMapping } from '../src/shared/store';

export default defineContentScript({
  // Keep in sync with src/adapters/registry.ts.
  matches: ['*://*.walmart.ca/*', '*://*.amazon.ca/*', '*://*.ebgames.ca/*', '*://store.401games.ca/*'],
  runAt: 'document_idle',
  async main() {
    const adapter = adapterFor(location.hostname);
    if (!adapter) return;

    const settings = await loadSettings();
    const [db, fx, mappings] = await Promise.all([loadDb(), loadFx(settings), loadMappings()]);
    const controller = new PageController(adapter, { db, settings, fx, mappings }, { saveMapping });
    controller.start();

    // Settings, exchange rate, mappings or database changed (popup/background) → re-render.
    browser.storage.onChanged.addListener(async (changes, area) => {
      if (area !== 'local') return;
      const keys = Object.keys(changes);
      if (!keys.some((k) => (Object.values(KEYS) as string[]).includes(k))) return;
      const s = await loadSettings();
      controller.updateState({ settings: s, fx: await loadFx(s), mappings: await loadMappings(), db: await loadDb() });
    });

    browser.runtime.onMessage.addListener((msg: Message, _sender, sendResponse) => {
      if (msg.type === 'MTGPL_GET_SUMMARY') sendResponse(controller.summary());
      else if (msg.type === 'MTGPL_REVEAL') sendResponse(controller.reveal(msg.key));
      return undefined;
    });
  },
});
