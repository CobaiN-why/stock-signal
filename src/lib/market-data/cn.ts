import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type {
  DailyBar,
  InstrumentRef,
  MarketDataProvider,
  StockProfile,
} from "@/lib/market-data/types";

const execFileAsync = promisify(execFile);

function pythonCommand(): string {
  return process.env.CN_MARKET_DATA_PYTHON || "python3";
}

function scriptPath(): string {
  return path.join(process.cwd(), "scripts", "cn-akshare-provider.py");
}

function providerSymbol(instrument: InstrumentRef): string {
  return (instrument.dataSymbol || instrument.ticker).replace(/\.(SH|SZ|BJ)$/i, "");
}

function assetType(instrument: InstrumentRef): "STOCK" | "ETF" {
  return instrument.assetType === "ETF" ? "ETF" : "STOCK";
}

async function runAkshare<T>(args: string[]): Promise<T> {
  const { stdout, stderr } = await execFileAsync(
    pythonCommand(),
    [scriptPath(), ...args],
    {
      timeout: 120_000,
      maxBuffer: 1024 * 1024 * 10,
    }
  );

  if (stderr.trim()) {
    const parsedError = safeParse<{ error?: string }>(stderr.trim());
    if (parsedError?.error) throw new Error(parsedError.error);
  }

  return JSON.parse(stdout) as T;
}

function safeParse<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export const cnMarketDataProvider: MarketDataProvider = {
  market: "CN",

  async fetchDailyBars(
    instrument: InstrumentRef,
    from: Date,
    to: Date
  ): Promise<DailyBar[]> {
    const rows = await runAkshare<
      {
        date: string;
        open: number;
        high: number;
        low: number;
        close: number;
        volume: number;
      }[]
    >([
      "bars",
      "--symbol",
      providerSymbol(instrument),
      "--asset-type",
      assetType(instrument),
      "--from-date",
      from.toISOString().slice(0, 10),
      "--to-date",
      to.toISOString().slice(0, 10),
    ]);

    return rows.map((row) => ({
      date: new Date(row.date),
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
      volume: row.volume,
    }));
  },

  async fetchLatestPrice(instrument: InstrumentRef): Promise<number | null> {
    const data = await runAkshare<{ price: number | null }>([
      "quote",
      "--symbol",
      providerSymbol(instrument),
      "--asset-type",
      assetType(instrument),
    ]);
    return data.price;
  },

  async fetchProfile(instrument: InstrumentRef): Promise<StockProfile | null> {
    return runAkshare<StockProfile>([
      "profile",
      "--symbol",
      providerSymbol(instrument),
      "--asset-type",
      assetType(instrument),
    ]);
  },
};
