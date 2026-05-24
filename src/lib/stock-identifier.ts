import { prisma } from "./db";

export interface StockMention {
  ticker: string;
  type: "cashtag" | "keyword";
}

const CASHTAG_REGEX = /\$([A-Z]{1,5})\b/g;

export async function identifyStocks(text: string): Promise<StockMention[]> {
  const mentions = new Map<string, StockMention>();

  // Layer 1: $CASHTAG extraction
  let match;
  while ((match = CASHTAG_REGEX.exec(text)) !== null) {
    const ticker = match[1];
    if (!mentions.has(ticker)) {
      mentions.set(ticker, { ticker, type: "cashtag" });
    }
  }

  // Layer 2: keyword matching
  const lowerText = text.toLowerCase();
  const mappings = await prisma.keywordMapping.findMany({
    include: { stock: true },
  });

  for (const mapping of mappings) {
    if (
      lowerText.includes(mapping.keyword) &&
      !mentions.has(mapping.stock.ticker)
    ) {
      mentions.set(mapping.stock.ticker, {
        ticker: mapping.stock.ticker,
        type: "keyword",
      });
    }
  }

  return Array.from(mentions.values());
}

export async function ensureStockExists(ticker: string): Promise<string> {
  const existing = await prisma.stock.findUnique({ where: { ticker } });
  if (existing) return existing.id;

  const stock = await prisma.stock.create({
    data: { ticker, companyName: "" },
  });
  return stock.id;
}
