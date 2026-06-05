import type {
  DailyBar,
  InstrumentRef,
  MarketDataProvider,
  StockProfile,
} from "@/lib/market-data/types";

const TWELVE_BASE = "https://api.twelvedata.com";
const FINNHUB_BASE = "https://finnhub.io/api/v1";

function getTwelveKey(): string {
  const key = process.env.TWELVE_DATA_API_KEY;
  if (!key) throw new Error("TWELVE_DATA_API_KEY not set");
  return key;
}

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

function providerSymbol(instrument: InstrumentRef): string {
  return instrument.dataSymbol || instrument.ticker;
}

export const usMarketDataProvider: MarketDataProvider = {
  market: "US",

  async fetchDailyBars(instrument: InstrumentRef, from: Date, to: Date): Promise<DailyBar[]> {
    const key = getTwelveKey();
    const symbol = providerSymbol(instrument);
    const startDate = from.toISOString().slice(0, 10);
    const endDate = to.toISOString().slice(0, 10);

    const url =
      `${TWELVE_BASE}/time_series?symbol=${symbol}&interval=1day` +
      `&start_date=${startDate}&end_date=${endDate}&outputsize=5000&apikey=${key}`;

    await throttleTwelve();
    const res = await fetch(url);
    let data: {
      status?: string;
      code?: number;
      message?: string;
      values?: {
        datetime: string;
        open: string;
        high: string;
        low: string;
        close: string;
        volume: string;
      }[];
    };
    try {
      data = await res.json();
    } catch {
      throw new Error(`Twelve Data error: ${res.status} (non-JSON response)`);
    }

    if (data.status === "error" || data.code) {
      const msg = data.message ?? JSON.stringify(data);
      if (data.code === 404) {
        console.warn(`Twelve Data: skipping ${symbol} - ${msg}`);
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
  },

  async fetchLatestPrice(instrument: InstrumentRef): Promise<number | null> {
    try {
      const token = getFinnhubToken();
      const symbol = providerSymbol(instrument);
      const res = await fetch(`${FINNHUB_BASE}/quote?symbol=${symbol}&token=${token}`);
      if (!res.ok) return null;
      const data = (await res.json()) as { c: number };
      return data.c || null;
    } catch {
      return null;
    }
  },

  async fetchProfile(instrument: InstrumentRef): Promise<StockProfile | null> {
    try {
      const token = getFinnhubToken();
      const symbol = providerSymbol(instrument);

      const [profileRes, metricRes] = await Promise.all([
        fetch(`${FINNHUB_BASE}/stock/profile2?symbol=${symbol}&token=${token}`),
        fetch(`${FINNHUB_BASE}/stock/metric?symbol=${symbol}&metric=all&token=${token}`),
      ]);

      if (!profileRes.ok || !metricRes.ok) return null;

      const profile = (await profileRes.json()) as Record<string, unknown>;
      const metricData = (await metricRes.json()) as { metric: Record<string, unknown> };
      const metric = metricData.metric ?? {};

      if (!profile.name) return null;

      const marketCapMillions = profile.marketCapitalization as number | undefined;

      return {
        shortName: (profile.name as string) ?? "",
        longName: (profile.name as string) ?? "",
        sector: (profile.finnhubIndustry as string) ?? "",
        industry: (profile.finnhubIndustry as string) ?? "",
        marketCap: marketCapMillions != null ? marketCapMillions * 1_000_000 : null,
        pe: (metric.peTTM as number) ?? null,
        forwardPe: null,
        eps: (metric.epsBasicExclExtraAnnual as number) ?? null,
        dividendYield: (metric.dividendYieldIndicatedAnnual as number) ?? null,
        fiftyTwoWeekHigh: (metric["52WeekHigh"] as number) ?? null,
        fiftyTwoWeekLow: (metric["52WeekLow"] as number) ?? null,
        avgVolume: (metric.averageVolume10D as number) ?? null,
        description: "",
      };
    } catch {
      return null;
    }
  },
};
