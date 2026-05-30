/**
 * Stock price & profile data via Finnhub API (official, cloud-friendly)
 * Replaces yahoo-finance2 which was blocked on Railway IPs.
 * Free tier: 60 req/min — sufficient for daily cron over ~50 stocks.
 */

const FINNHUB_BASE = "https://finnhub.io/api/v1";

function getToken(): string {
  const token = process.env.FINNHUB_API_KEY;
  if (!token) throw new Error("FINNHUB_API_KEY not set");
  return token;
}

export interface DailyBar {
  date: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export async function fetchDailyBars(
  ticker: string,
  from: Date,
  to: Date
): Promise<DailyBar[]> {
  const token = getToken();
  const fromTs = Math.floor(from.getTime() / 1000);
  const toTs = Math.floor(to.getTime() / 1000);

  const url =
    `${FINNHUB_BASE}/stock/candle?symbol=${ticker}&resolution=D` +
    `&from=${fromTs}&to=${toTs}&token=${token}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Finnhub candle error: ${res.status} ${await res.text()}`);

  const data = (await res.json()) as {
    s: string;
    t: number[];
    o: number[];
    h: number[];
    l: number[];
    c: number[];
    v: number[];
  };

  if (data.s !== "ok") return []; // "no_data" — normal for weekends/holidays

  return data.t.map((ts, i) => ({
    date: new Date(ts * 1000),
    open: data.o[i],
    high: data.h[i],
    low: data.l[i],
    close: data.c[i],
    volume: data.v[i],
  }));
}

export async function fetchLatestPrice(ticker: string): Promise<number | null> {
  try {
    const token = getToken();
    const res = await fetch(`${FINNHUB_BASE}/quote?symbol=${ticker}&token=${token}`);
    if (!res.ok) return null;
    const data = (await res.json()) as { c: number };
    return data.c || null;
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

export async function fetchStockProfile(ticker: string): Promise<StockProfile | null> {
  try {
    const token = getToken();

    const [profileRes, metricRes] = await Promise.all([
      fetch(`${FINNHUB_BASE}/stock/profile2?symbol=${ticker}&token=${token}`),
      fetch(`${FINNHUB_BASE}/stock/metric?symbol=${ticker}&metric=all&token=${token}`),
    ]);

    if (!profileRes.ok || !metricRes.ok) return null;

    const profile = (await profileRes.json()) as Record<string, unknown>;
    const metricData = (await metricRes.json()) as { metric: Record<string, unknown> };
    const metric = metricData.metric ?? {};

    // Empty response = ticker not found on Finnhub
    if (!profile.name) return null;

    const marketCapMillions = profile.marketCapitalization as number | undefined;

    return {
      shortName: (profile.name as string) ?? "",
      longName: (profile.name as string) ?? "",
      // Finnhub has one industry field; use for both sector & industry
      sector: (profile.finnhubIndustry as string) ?? "",
      industry: (profile.finnhubIndustry as string) ?? "",
      // Finnhub returns market cap in millions USD → convert to USD
      marketCap: marketCapMillions != null ? marketCapMillions * 1_000_000 : null,
      pe: (metric.peTTM as number) ?? null,
      forwardPe: null, // not available on free tier
      eps: (metric.epsBasicExclExtraAnnual as number) ?? null,
      dividendYield: (metric.dividendYieldIndicatedAnnual as number) ?? null,
      fiftyTwoWeekHigh: (metric["52WeekHigh"] as number) ?? null,
      fiftyTwoWeekLow: (metric["52WeekLow"] as number) ?? null,
      avgVolume: (metric.averageVolume10D as number) ?? null,
      description: "", // not provided on Finnhub free tier; Kimi analysis covers this
    };
  } catch {
    return null;
  }
}
