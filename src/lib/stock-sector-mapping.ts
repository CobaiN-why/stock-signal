import { prisma } from "@/lib/db";
import { normalizeMarket, type AssetType } from "@/lib/markets";
import type { SectorMention } from "@/lib/sector-identifier";

interface SectorRow {
  id: string;
  market: string;
  slug: string;
  name: string;
}

function confidenceForAsset(assetType: AssetType): number {
  return assetType === "ETF" ? 0.75 : 0.25;
}

function evidenceForAsset(ticker: string, assetType: AssetType): string {
  return assetType === "ETF"
    ? `由 ETF ${ticker} 映射到板块`
    : `由 ${ticker} 推断`;
}

function toSectorMention(
  sector: SectorRow,
  ticker: string,
  assetType: AssetType
): SectorMention {
  return {
    sectorId: sector.id,
    market: normalizeMarket(sector.market),
    slug: sector.slug,
    name: sector.name,
    evidence: evidenceForAsset(ticker, assetType),
    confidence: confidenceForAsset(assetType),
  };
}

function mergeSectorMention(
  target: Map<string, SectorMention>,
  mention: SectorMention
) {
  const existing = target.get(mention.sectorId);
  if (!existing || mention.confidence > existing.confidence) {
    target.set(mention.sectorId, mention);
  }
}

export async function inferSectorsFromStockMention(
  stockId: string,
  ticker: string,
  marketValue: string | null | undefined,
  assetType: AssetType
): Promise<SectorMention[]> {
  const market = normalizeMarket(marketValue);
  const mentions = new Map<string, SectorMention>();

  const stock = await prisma.stock.findUnique({
    where: { id: stockId },
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

  if (stock?.sector) {
    mergeSectorMention(
      mentions,
      toSectorMention(stock.sector, ticker, assetType)
    );
  }

  if (assetType === "ETF") {
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

    for (const mapped of mappedSectors) {
      mergeSectorMention(
        mentions,
        toSectorMention(mapped.sector, ticker, assetType)
      );
    }
  }

  return Array.from(mentions.values());
}
