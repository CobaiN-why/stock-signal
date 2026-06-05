import { prisma } from "@/lib/db";
import { DEFAULT_MARKET, normalizeMarket, type Market } from "@/lib/markets";

export interface SectorMention {
  sectorId: string;
  market: Market;
  slug: string;
  name: string;
  evidence: string;
  confidence: number;
}

export async function identifySectors(
  text: string,
  marketValue: string | null | undefined = DEFAULT_MARKET
): Promise<SectorMention[]> {
  const market = normalizeMarket(marketValue);
  const lowerText = text.toLowerCase();
  const matches = new Map<string, SectorMention>();

  const keywords = await prisma.sectorKeyword.findMany({
    where: { sector: { market } },
    include: { sector: true },
  });

  for (const item of keywords) {
    const keyword = item.keyword.toLowerCase();
    if (!keyword || !lowerText.includes(keyword)) continue;
    if (!matches.has(item.sectorId)) {
      matches.set(item.sectorId, {
        sectorId: item.sectorId,
        market,
        slug: item.sector.slug,
        name: item.sector.name,
        evidence: item.keyword,
        confidence: 1,
      });
    }
  }

  return Array.from(matches.values());
}
