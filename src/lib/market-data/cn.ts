/**
 * CN market data provider — Sina Finance (新浪财经) HTTP API.
 *
 * Sina Finance provides free, no-registration K-line and quote data via JSON/JS APIs.
 * This is one of the most stable and widely-used free data sources for A-shares.
 *
 * K-line API:
 *   https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData
 *   Params: symbol=sh512760, scale=240 (daily), datalen=N
 *
 * Quote API:
 *   https://hq.sinajs.cn/list=sh512760
 *   Returns JS var string with real-time price
 */

import type {
  DailyBar,
  InstrumentRef,
  MarketDataProvider,
  StockProfile,
} from "@/lib/market-data/types";

const SINA_KLINE_URL =
  "https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData";
const SINA_QUOTE_URL = "https://hq.sinajs.cn/list=";

function sinaSymbol(instrument: InstrumentRef): string {
  const code = (instrument.dataSymbol || instrument.ticker).replace(
    /\.(SH|SZ|BJ)$/i,
    ""
  );
  const prefix = code.charAt(0);
  // SH: 5xxxxx, 6xxxxx, 9xxxxx  |  SZ: 0xxxxx, 1xxxxx, 3xxxxx, 7xxxxx
  return prefix === "5" || prefix === "6" || prefix === "9"
    ? `sh${code}`
    : `sz${code}`;
}

interface SinaKlineRow {
  day: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
}

async function fetchSinaKlines(
  symbol: string,
  from: Date,
  to: Date
): Promise<DailyBar[]> {
  // Request enough data points to cover the range (≈ 250 trading days/year)
  const datalen = 300;

  const url = `${SINA_KLINE_URL}?symbol=${symbol}&scale=240&datalen=${datalen}`;

  const resp = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      Referer: "https://finance.sina.com.cn/",
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!resp.ok) {
    throw new Error(`Sina HTTP ${resp.status}`);
  }

  const text = await resp.text();
  if (!text || text.trim() === "null") return [];

  const rows = JSON.parse(text) as SinaKlineRow[];
  if (!Array.isArray(rows) || rows.length === 0) return [];

  const fromTime = from.getTime();
  const toTime = to.getTime();

  return rows
    .map((row) => {
      const date = new Date(row.day);
      if (Number.isNaN(date.getTime())) return null;
      // Filter by date range (Sina returns N most recent points, no date params)
      if (date.getTime() < fromTime || date.getTime() > toTime) return null;

      const open = Number(row.open);
      const high = Number(row.high);
      const low = Number(row.low);
      const close = Number(row.close);
      const volume = Number(row.volume);

      if (
        Number.isNaN(open) ||
        Number.isNaN(high) ||
        Number.isNaN(low) ||
        Number.isNaN(close) ||
        Number.isNaN(volume)
      ) {
        return null;
      }

      return { date, open, high, low, close, volume };
    })
    .filter(Boolean) as DailyBar[];
}

async function fetchSinaLatestPrice(symbol: string): Promise<number | null> {
  const url = `${SINA_QUOTE_URL}${symbol}`;

  const resp = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      Referer: "https://finance.sina.com.cn/",
    },
    signal: AbortSignal.timeout(10000),
  });

  if (!resp.ok) return null;

  const text = await resp.text();
  // Format: var hq_str_sh512760="name,open,prev_close,price,high,low,..."
  const match = text.match(/"([^"]+)"/);
  if (!match) return null;

  const fields = match[1].split(",");
  // Field index 3 is current price
  const price = Number(fields[3]);
  return price > 0 ? price : null;
}

export const cnMarketDataProvider: MarketDataProvider = {
  market: "CN",

  async fetchDailyBars(
    instrument: InstrumentRef,
    from: Date,
    to: Date
  ): Promise<DailyBar[]> {
    const symbol = sinaSymbol(instrument);
    return fetchSinaKlines(symbol, from, to);
  },

  async fetchLatestPrice(instrument: InstrumentRef): Promise<number | null> {
    const symbol = sinaSymbol(instrument);
    return fetchSinaLatestPrice(symbol);
  },

  async fetchProfile(
    _instrument: InstrumentRef
  ): Promise<StockProfile | null> {
    // CN profiles are fetched separately via the Python akshare bridge
    // (sync-profiles cron step). Return null here for the interface.
    return null;
  },
};
