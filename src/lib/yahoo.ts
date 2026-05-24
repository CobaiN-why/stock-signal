import yahooFinance from "yahoo-finance2";

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
