import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { normalizeMarket, type Market } from "@/lib/markets";

interface PriceSyncSelectionOptions {
  market?: Market | null;
  ticker?: string | null;
  includeSeeded?: boolean;
}

export function buildPriceSyncStockWhere(
  options: PriceSyncSelectionOptions = {}
): Prisma.StockWhereInput {
  const market = options.market ? normalizeMarket(options.market) : null;
  const ticker = options.ticker?.toUpperCase() ?? null;

  if (ticker) {
    return {
      market: market ?? "US",
      ticker,
    };
  }

  return {
    ...(market ? { market } : {}),
    ...(options.includeSeeded
      ? {}
      : {
          OR: [
            { postStocks: { some: {} } },
            {
              assetType: "ETF",
              sector: { postSectors: { some: {} } },
            },
          ],
        }),
  };
}

export async function findPriceSyncStocks(
  options: PriceSyncSelectionOptions = {}
) {
  const market = options.market ? normalizeMarket(options.market) : null;
  const ticker = options.ticker?.toUpperCase() ?? null;
  const stocks = await prisma.stock.findMany({
    where: buildPriceSyncStockWhere(options),
  });

  if (ticker || options.includeSeeded) return stocks;

  const mappedEtfs = await prisma.sectorEtf.findMany({
    where: {
      ...(market ? { market } : {}),
      sector: {
        postSectors: { some: {} },
      },
    },
    select: {
      market: true,
      ticker: true,
    },
  });

  const existingKeys = new Set(stocks.map((stock) => `${stock.market}:${stock.ticker}`));
  const missing = mappedEtfs.filter(
    (etf) => !existingKeys.has(`${etf.market}:${etf.ticker}`)
  );
  if (missing.length === 0) return stocks;

  const extraStocks = await prisma.stock.findMany({
    where: {
      OR: missing.map((etf) => ({
        market: normalizeMarket(etf.market),
        ticker: etf.ticker,
      })),
    },
  });

  return [...stocks, ...extraStocks];
}
