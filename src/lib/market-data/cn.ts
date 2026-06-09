/**
 * CN market data provider — Eastmoney (东方财富) HTTP API.
 *
 * Eastmoney provides free, no-registration K-line data via JSON API.
 * This replaces the Python akshare bridge for OHLCV data, eliminating
 * the Python dependency and associated network reliability issues.
 *
 * API reference:
 *   http://push2his.eastmoney.com/api/qt/stock/kline/get
 *
 * Secid format:
 *   SH stocks/ETFs: 1.{code}  (codes starting with 5, 6, 9)
 *   SZ stocks/ETFs: 0.{code}  (codes starting with 0, 1, 3, 7)
 */

import type {
  DailyBar,
  InstrumentRef,
  MarketDataProvider,
  StockProfile,
} from "@/lib/market-data/types";

const EASTMONEY_KLINE_URL =
  "https://push2his.eastmoney.com/api/qt/stock/kline/get";

const PROFILES: Record<string, StockProfile> = {};

function resolveSecid(instrument: InstrumentRef): string {
  const code = (instrument.dataSymbol || instrument.ticker).replace(
    /\.(SH|SZ|BJ)$/i,
    ""
  );
  // Determine exchange from code prefix
  // SH: 5xxxxx, 6xxxxx, 9xxxxx
  // SZ: 0xxxxx, 1xxxxx, 3xxxxx, 7xxxxx
  const prefix = code.charAt(0);
  if (prefix === "5" || prefix === "6" || prefix === "9") {
    return `1.${code}`;
  }
  return `0.${code}`;
}

interface EastmoneyKlineResponse {
  data?: {
    code: string;
    name: string;
    klines?: string[];
  };
  rc?: number;
  message?: string;
}

/**
 * Eastmoney kline entry (comma-separated):
 * date, open, close, high, low, volume, amount, amplitude, chg%, chg, turnover%
 */
function parseKlineEntry(raw: string): DailyBar | null {
  const parts = raw.split(",");
  if (parts.length < 7) return null;

  const date = parts[0];
  const open = Number(parts[1]);
  const close = Number(parts[2]);
  const high = Number(parts[3]);
  const low = Number(parts[4]);
  const volume = Number(parts[5]); // volume in lots (手)

  if (
    !date ||
    Number.isNaN(open) ||
    Number.isNaN(close) ||
    Number.isNaN(high) ||
    Number.isNaN(low) ||
    Number.isNaN(volume)
  ) {
    return null;
  }

  return {
    date: new Date(date),
    open,
    high,
    low,
    close,
    volume: Math.round(volume * 100), // convert lots to shares
  };
}

async function fetchEastmoneyKlines(
  secid: string,
  from: Date,
  to: Date,
  period: number = 101 // 101=daily
): Promise<DailyBar[]> {
  const beg = from.toISOString().slice(0, 10).replace(/-/g, "");
  const end = to.toISOString().slice(0, 10).replace(/-/g, "");

  const url = `${EASTMONEY_KLINE_URL}?secid=${secid}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57&klt=${period}&fqt=1&beg=${beg}&end=${end}&lmt=300`;

  const resp = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      Referer: "https://quote.eastmoney.com/",
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!resp.ok) {
    throw new Error(`Eastmoney HTTP ${resp.status}`);
  }

  const body = (await resp.json()) as EastmoneyKlineResponse;
  if (!body.data?.klines || body.data.klines.length === 0) {
    return [];
  }

  return body.data.klines.map(parseKlineEntry).filter(Boolean) as DailyBar[];
}

/**
 * Eastmoney real-time quote API.
 * URL: https://push2.eastmoney.com/api/qt/stock/get
 */
async function fetchEastmoneyLatestPrice(secid: string): Promise<number | null> {
  const url = `https://push2.eastmoney.com/api/qt/stock/get?secid=${secid}&fields=f43`;

  const resp = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      Referer: "https://quote.eastmoney.com/",
    },
    signal: AbortSignal.timeout(10000),
  });

  if (!resp.ok) return null;

  const body = (await resp.json()) as { data?: { f43?: number } };
  const price = body.data?.f43;
  return typeof price === "number" && price > 0 ? price / 100 : null;
}

export const cnMarketDataProvider: MarketDataProvider = {
  market: "CN",

  async fetchDailyBars(
    instrument: InstrumentRef,
    from: Date,
    to: Date
  ): Promise<DailyBar[]> {
    const secid = resolveSecid(instrument);
    return fetchEastmoneyKlines(secid, from, to, 101);
  },

  async fetchLatestPrice(instrument: InstrumentRef): Promise<number | null> {
    const secid = resolveSecid(instrument);
    return fetchEastmoneyLatestPrice(secid);
  },

  async fetchProfile(
    _instrument: InstrumentRef
  ): Promise<StockProfile | null> {
    // CN profiles are fetched separately via the Python akshare bridge
    // (sync-profiles cron step). Return null here to avoid breaking
    // the provider interface.
    return null;
  },
};
