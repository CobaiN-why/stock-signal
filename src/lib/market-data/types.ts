import type { AssetType, Market } from "@/lib/markets";

export interface DailyBar {
  date: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface StockProfile {
  shortName: string;
  longName: string;
  sector: string;
  industry: string;
  marketCap: number | null;
  pe: number | null;
  forwardPe: number | null;
  eps: number | null;
  dividendYield: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  avgVolume: number | null;
  description: string;
}

export interface InstrumentRef {
  ticker: string;
  market: Market;
  assetType?: AssetType;
  dataSymbol?: string | null;
}

export interface MarketDataProvider {
  market: Market;
  fetchDailyBars(instrument: InstrumentRef, from: Date, to: Date): Promise<DailyBar[]>;
  fetchLatestPrice(instrument: InstrumentRef): Promise<number | null>;
  fetchProfile(instrument: InstrumentRef): Promise<StockProfile | null>;
}
