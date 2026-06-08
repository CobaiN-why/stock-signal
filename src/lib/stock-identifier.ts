import { prisma } from "./db";
import {
  ALL_MARKETS,
  DEFAULT_MARKET,
  marketConfig,
  normalizeMarket,
  type AssetType,
  type Market,
} from "./markets";

export interface StockMention {
  ticker: string;
  market: Market;
  assetType: AssetType;
  type: "cashtag" | "keyword" | "code";
}

const CASHTAG_REGEX = /\$([A-Z]{1,5})\b/g;
const CN_INSTRUMENT_CODE_REGEX =
  /(?:^|[^\d])((?:00|15|30|51|58|60|68)\d{4})(?=$|[^\d])/g;

export async function identifyStocks(
  text: string,
  marketValue: string | null | undefined = DEFAULT_MARKET
): Promise<StockMention[]> {
  const market = normalizeMarket(marketValue);
  const mentions = new Map<string, StockMention>();

  if (market === "US") {
    let match;
    while ((match = CASHTAG_REGEX.exec(text)) !== null) {
      const ticker = match[1].toUpperCase();
      if (!mentions.has(ticker)) {
        mentions.set(ticker, { ticker, market, assetType: "STOCK", type: "cashtag" });
      }
    }
  } else if (market === "CN") {
    let match;
    while ((match = CN_INSTRUMENT_CODE_REGEX.exec(text)) !== null) {
      const ticker = match[1];
      if (!mentions.has(ticker)) {
        const assetType = /^(15|51|58)/.test(ticker) ? "ETF" : "STOCK";
        mentions.set(ticker, { ticker, market, assetType, type: "code" });
      }
    }
  }

  // Layer 2: keyword matching
  const lowerText = text.toLowerCase();
  const mappings = await prisma.keywordMapping.findMany({
    where: { market },
    include: { stock: true },
  });

  for (const mapping of mappings) {
    if (
      lowerText.includes(mapping.keyword) &&
      !mentions.has(mapping.stock.ticker)
    ) {
      mentions.set(mapping.stock.ticker, {
        ticker: mapping.stock.ticker,
        market,
        assetType: mapping.stock.assetType as AssetType,
        type: "keyword",
      });
    }
  }

  return Array.from(mentions.values());
}

export async function identifyStocksAcrossMarkets(
  text: string
): Promise<StockMention[]> {
  const matches = await Promise.all(
    ALL_MARKETS.map((market) => identifyStocks(text, market))
  );
  const mentions = new Map<string, StockMention>();

  for (const mention of matches.flat()) {
    const key = `${mention.market}:${mention.ticker}`;
    if (!mentions.has(key)) mentions.set(key, mention);
  }

  return Array.from(mentions.values());
}

export async function ensureStockExists(
  ticker: string,
  marketValue: string | null | undefined = DEFAULT_MARKET,
  assetType: AssetType = "STOCK"
): Promise<{ id: string; isNew: boolean }> {
  const market = normalizeMarket(marketValue);
  const existing = await prisma.stock.findUnique({
    where: { market_ticker: { market, ticker } },
  });
  if (existing) return { id: existing.id, isNew: false };

  const cfg = marketConfig(market);
  const stock = await prisma.stock.create({
    data: {
      ticker,
      market,
      assetType,
      currency: cfg.currency,
      companyName: "",
    },
  });
  return { id: stock.id, isNew: true };
}
