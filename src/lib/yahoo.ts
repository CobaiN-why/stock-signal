import YahooFinanceClass from "yahoo-finance2";
// v3: default export is the class, must instantiate
const yahooFinance = new YahooFinanceClass({ suppressNotices: ["ripHistorical"] });

export interface DailyBar {
  date: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface YFHistoricalRow {
  date: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  adjClose?: number;
}

export async function fetchDailyBars(
  ticker: string,
  from: Date,
  to: Date
): Promise<DailyBar[]> {
  const result = (await yahooFinance.historical(ticker, {
    period1: from,
    period2: to,
    interval: "1d",
  })) as YFHistoricalRow[];

  return result
    .filter((q) => q.close != null)
    .map((q) => ({
      date: q.date,
      open: q.open,
      high: q.high,
      low: q.low,
      close: q.close,
      volume: q.volume,
    }));
}

export async function fetchLatestPrice(
  ticker: string
): Promise<number | null> {
  try {
    const result = await yahooFinance.quote(ticker);
    return (result as { regularMarketPrice?: number }).regularMarketPrice ?? null;
  } catch {
    return null;
  }
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

export async function fetchStockProfile(
  ticker: string
): Promise<StockProfile | null> {
  try {
    const result = await yahooFinance.quoteSummary(ticker, {
      modules: ["assetProfile", "summaryDetail", "price", "defaultKeyStatistics"],
    });

    const profile = result.assetProfile as Record<string, unknown> | undefined;
    const summary = result.summaryDetail as Record<string, unknown> | undefined;
    const price = result.price as Record<string, unknown> | undefined;

    return {
      shortName: (price?.shortName as string) ?? "",
      longName: (price?.longName as string) ?? "",
      sector: (profile?.sector as string) ?? "",
      industry: (profile?.industry as string) ?? "",
      marketCap: (price?.marketCap as number) ?? null,
      pe: (summary?.trailingPE as number) ?? null,
      forwardPe: (summary?.forwardPE as number) ?? null,
      eps: (result.defaultKeyStatistics as Record<string, unknown>)?.trailingEps as number ?? null,
      dividendYield: (summary?.dividendYield as number) ?? null,
      fiftyTwoWeekHigh: (summary?.fiftyTwoWeekHigh as number) ?? null,
      fiftyTwoWeekLow: (summary?.fiftyTwoWeekLow as number) ?? null,
      avgVolume: (summary?.averageVolume as number) ?? null,
      description: (profile?.longBusinessSummary as string) ?? "",
    };
  } catch {
    return null;
  }
}
