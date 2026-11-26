import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'MTG Price Lens',
    description: 'See whether sealed Magic: The Gathering products on Canadian retailers are above or below official MSRP.',
    // Minimal permissions: storage for settings/cache, alarms for the daily exchange-rate refresh.
    permissions: ['storage', 'alarms'],
    // Only the Bank of Canada exchange-rate API is contacted. No analytics, no backend.
    host_permissions: ['https://www.bankofcanada.ca/valet/*'],
    // Requested at runtime only if the user configures a remote database URL.
    optional_host_permissions: ['https://*/*'],
    icons: { 16: 'icon/16.png', 32: 'icon/32.png', 48: 'icon/48.png', 128: 'icon/128.png' },
    action: { default_title: 'MTG Price Lens' },
  },
});
