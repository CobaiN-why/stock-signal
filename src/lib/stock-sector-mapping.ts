import { prisma } from "@/lib/db";
import { normalizeMarket, type AssetType } from "@/lib/markets";
import type { SectorMention } from "@/lib/sector-identifier";

/**
 * Infer CN sectors from an ETF mention via the SectorEtf DB mapping.
 * Individual stock sector inference is now handled by AI (sector-ai.ts).
 */
export async function inferSectorsFromStockMention(
  stockId: string,
  ticker: string,
  marketValue: string | null | undefined,
  assetType: AssetType
): Promise<SectorMention[]> {
  const market = normalizeMarket(marketValue);

  // Only CN ETFs have reliable DB sector mappings
  if (assetType !== "ETF" || market !== "CN") return [];

  const mappedSectors = await prisma.sectorEtf.findMany({
    where: { market, ticker },
    select: {
      sector: {
        select: {
          id: true,
          market: true,
          slug: true,
          name: true,
        },
      },
    },
  });

  return mappedSectors.map((mapped) => ({
    sectorId: mapped.sector.id,
    market: normalizeMarket(mapped.sector.market),
    slug: mapped.sector.slug,
    name: mapped.sector.name,
    evidence: `由 ETF ${ticker} 映射到板块`,
    confidence: 0.75,
    sentimentTarget: ticker,
  }));
}
