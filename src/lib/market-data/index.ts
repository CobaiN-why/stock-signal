import { normalizeMarket, type Market } from "@/lib/markets";
import type { InstrumentRef, MarketDataProvider } from "@/lib/market-data/types";
import { cnMarketDataProvider } from "@/lib/market-data/cn";
import { usMarketDataProvider } from "@/lib/market-data/us";

const providers: Record<Market, MarketDataProvider> = {
  US: usMarketDataProvider,
  CN: cnMarketDataProvider,
};

export function getMarketDataProvider(market: Market): MarketDataProvider {
  const provider = providers[market];
  if (!provider) {
    throw new Error(`Market data provider not configured for ${market}`);
  }
  return provider;
}

export async function fetchDailyBars(
  instrument: InstrumentRef,
  from: Date,
  to: Date
) {
  return getMarketDataProvider(normalizeMarket(instrument.market)).fetchDailyBars(
    instrument,
    from,
    to
  );
}

export async function fetchLatestPrice(instrument: InstrumentRef) {
  return getMarketDataProvider(normalizeMarket(instrument.market)).fetchLatestPrice(
    instrument
  );
}

export async function fetchStockProfile(instrument: InstrumentRef) {
  return getMarketDataProvider(normalizeMarket(instrument.market)).fetchProfile(
    instrument
  );
}

export type { DailyBar, InstrumentRef, MarketDataProvider, StockProfile } from "./types";
