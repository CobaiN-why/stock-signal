/**
 * CN market data provider — multiple free sources.
 *
 * K-line (historical OHLCV): Tencent Finance API (前复权 daily bars)
 *   URL: https://web.ifzq.gtimg.cn/appstock/app/fqkline/get
 *   Params: param={symbol},day,,,{count},qfq
 *   Returns forward-adjusted (前复权) data matching trading apps like 东方财富
 *   Format: [date, open, close, high, low, volume] — volume in lots (手)
 *
 * Latest price: Sina Finance real-time quote
 *   URL: https://hq.sinajs.cn/list={symbol}
 *   Returns JS var with real-time price at field index 3
 */

import type {
  DailyBar,
  InstrumentRef,
  MarketDataProvider,
  StockProfile,
} from "@/lib/market-data/types";

const TENCENT_KLINE_URL =
  "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get";
const SINA_QUOTE_URL = "https://hq.sinajs.cn/list=";

function tencentSymbol(instrument: InstrumentRef): string {
  const code = (instrument.dataSymbol || instrument.ticker).replace(
    /\.(SH|SZ|BJ)$/i,
    ""
  );
  const prefix = code.charAt(0);
  return prefix === "5" || prefix === "6" || prefix === "9"
    ? `sh${code}`
    : `sz${code}`;
}

function sinaSymbol(instrument: InstrumentRef): string {
  const code = (instrument.dataSymbol || instrument.ticker).replace(
    /\.(SH|SZ|BJ)$/i,
    ""
  );
  const prefix = code.charAt(0);
  return prefix === "5" || prefix === "6" || prefix === "9"
    ? `sh${code}`
    : `sz${code}`;
}

interface TencentKlineResponse {
  code: number;
  msg: string;
  data?: Record<
    string,
    {
      qfqday?: string[][]; // [date, open, close, high, low, volume]
      qt?: unknown;
    }
  >;
}

async function fetchTencentKlines(
  symbol: string,
  from: Date,
  to: Date
): Promise<DailyBar[]> {
  // Request up to 320 data points (~15 months of daily data)
  const url = `${TENCENT_KLINE_URL}?param=${symbol},day,,,320,qfq`;

  const resp = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      Referer: "https://gu.qq.com/",
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!resp.ok) {
    throw new Error(`Tencent HTTP ${resp.status}`);
  }

  const body = (await resp.json()) as TencentKlineResponse;
  if (body.code !== 0 || !body.data) return [];

  const stockData = body.data[symbol];
  if (!stockData?.qfqday || stockData.qfqday.length === 0) return [];

  const fromTime = from.getTime();
  const toTime = to.getTime();

  return stockData.qfqday
    .map((row) => {
      // Tencent format: [date, open, close, high, low, volume]
      if (row.length < 6) return null;

      const date = new Date(row[0]);
      if (Number.isNaN(date.getTime())) return null;
      if (date.getTime() < fromTime || date.getTime() > toTime) return null;

      const open = Number(row[1]);
      const close = Number(row[2]);
      const high = Number(row[3]);
      const low = Number(row[4]);
      const volume = Number(row[5]);

      if (
        Number.isNaN(open) ||
        Number.isNaN(high) ||
        Number.isNaN(low) ||
        Number.isNaN(close) ||
        Number.isNaN(volume)
      ) {
        return null;
      }

      return {
        date,
        open,
        high,
        low,
        close,
        volume: Math.round(volume * 100), // lots (手) → shares
      };
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
    const symbol = tencentSymbol(instrument);
    return fetchTencentKlines(symbol, from, to);
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
