/**
 * Stock price & profile data — hybrid approach (cloud-friendly, fully free):
 *   - fetchDailyBars   → Twelve Data  (800 req/day free; historical daily OHLCV)
 *   - fetchLatestPrice → Finnhub      (60 req/min free; real-time quote)
 *   - fetchStockProfile→ Finnhub      (60 req/min free; company profile + metrics)
 *
 * Background: yahoo-finance2 (scraper) gets TCP-blocked on Railway IPs unpredictably.
 */

const TWELVE_BASE = "https://api.twelvedata.com";
const FINNHUB_BASE = "https://finnhub.io/api/v1";

function getTwelveKey(): string {
  const key = process.env.TWELVE_DATA_API_KEY;
  if (!key) throw new Error("TWELVE_DATA_API_KEY not set");
  return key;
}

// Twelve Data free tier: 8 credits/min. Throttle calls to stay under the limit
// (8s interval ⇒ max 7.5 req/min). Module-level state shared across one job run.
const TWELVE_MIN_INTERVAL_MS = 8000;
let lastTwelveCallAt = 0;

async function throttleTwelve(): Promise<void> {
  const wait = TWELVE_MIN_INTERVAL_MS - (Date.now() - lastTwelveCallAt);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastTwelveCallAt = Date.now();
}

function getFinnhubToken(): string {
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
  const key = getTwelveKey();
  const startDate = from.toISOString().slice(0, 10);
  const endDate = to.toISOString().slice(0, 10);

  const url =
    `${TWELVE_BASE}/time_series?symbol=${ticker}&interval=1day` +
    `&start_date=${startDate}&end_date=${endDate}&outputsize=5000&apikey=${key}`;

  // Twelve Data returns a JSON body even on error (incl. HTTP 404), so parse first.
  await throttleTwelve();
  const res = await fetch(url);
  let data: {
    status?: string;
    code?: number;
    message?: string;
    values?: { datetime: string; open: string; high: string; low: string; close: string; volume: string }[];
  };
  try {
    data = await res.json();
  } catch {
    throw new Error(`Twelve Data error: ${res.status} (non-JSON response)`);
  }

  if (data.status === "error" || data.code) {
    const msg = data.message ?? JSON.stringify(data);
    // 404 = symbol not found or not on free plan → degrade to no data, don't crash the run
    if (data.code === 404) {
      console.warn(`Twelve Data: skipping ${ticker} — ${msg}`);
      return [];
    }
    throw new Error(`Twelve Data error: ${msg}`);
  }

  return (data.values ?? []).map((v) => ({
    date: new Date(v.datetime),
    open: parseFloat(v.open),
    high: parseFloat(v.high),
    low: parseFloat(v.low),
    close: parseFloat(v.close),
    volume: parseFloat(v.volume),
  }));
}

export async function fetchLatestPrice(ticker: string): Promise<number | null> {
  try {
    const token = getFinnhubToken();
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
    const token = getFinnhubToken();

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
