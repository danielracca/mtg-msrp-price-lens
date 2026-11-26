export interface Thresholds {
  /** % below MSRP for "dark green" (inclusive). */
  greatDeal: number;
  /** % below/above MSRP beyond which the price is no longer "at MSRP". */
  neutralBand: number;
  /** % above MSRP for "red" (inclusive). */
  highMarkup: number;
}

export interface Settings {
  badgesEnabled: boolean;
  /** Minimum % below MSRP for a product to count as a deal (used with showOnlyBelowMsrp and popup deals). */
  minDiscountPct: number;
  showOnlyBelowMsrp: boolean;
  showEstimatedBenchmarks: boolean;
  displayCurrency: 'CAD' | 'CAD_USD';
  customRate: number | null;
  thresholds: Thresholds;
  remoteDbUrl: string;
}

export const DEFAULT_SETTINGS: Settings = {
  badgesEnabled: true,
  minDiscountPct: 0,
  showOnlyBelowMsrp: false,
  showEstimatedBenchmarks: true,
  displayCurrency: 'CAD',
  customRate: null,
  thresholds: { greatDeal: 20, neutralBand: 5, highMarkup: 20 },
  remoteDbUrl: '',
};

export function mergeSettings(stored: Partial<Settings> | undefined | null): Settings {
  return {
    ...DEFAULT_SETTINGS,
    ...(stored ?? {}),
    thresholds: { ...DEFAULT_SETTINGS.thresholds, ...(stored?.thresholds ?? {}) },
  };
}
