import {
  fetchDailyBars as fetchDailyBarsForInstrument,
  fetchLatestPrice as fetchLatestPriceForInstrument,
  fetchStockProfile as fetchStockProfileForInstrument,
  type DailyBar,
  type StockProfile,
} from "@/lib/market-data";
import { DEFAULT_MARKET } from "@/lib/markets";

export type { DailyBar, StockProfile };

export function fetchDailyBars(
  ticker: string,
  from: Date,
  to: Date
): Promise<DailyBar[]> {
  return fetchDailyBarsForInstrument({ ticker, market: DEFAULT_MARKET }, from, to);
}

export function fetchLatestPrice(ticker: string): Promise<number | null> {
  return fetchLatestPriceForInstrument({ ticker, market: DEFAULT_MARKET });
}

export function fetchStockProfile(ticker: string): Promise<StockProfile | null> {
  return fetchStockProfileForInstrument({ ticker, market: DEFAULT_MARKET });
}
