import type { Prisma } from "@/generated/prisma/client";
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
