export type Market = "US" | "CN";
export type AssetType = "STOCK" | "ETF";

export const DEFAULT_MARKET: Market = "US";
export const ALL_MARKETS: Market[] = ["US", "CN"];

export interface MarketConfig {
  market: Market;
  label: string;
  currency: string;
  tickerPrefix: string;
}

const MARKET_CONFIG: Record<Market, MarketConfig> = {
  US: {
    market: "US",
    label: "美股",
    currency: "USD",
    tickerPrefix: "$",
  },
  CN: {
    market: "CN",
    label: "A股",
    currency: "CNY",
    tickerPrefix: "",
  },
};

export function normalizeMarket(value: string | null | undefined): Market {
  const upper = value?.toUpperCase();
  return upper === "CN" ? "CN" : "US";
}

export function marketConfig(market: Market): MarketConfig {
  return MARKET_CONFIG[market];
}

export function formatInstrumentLabel(ticker: string, market: Market): string {
  const cfg = marketConfig(market);
  return `${cfg.tickerPrefix}${ticker}`;
}
