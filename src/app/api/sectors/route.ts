import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { normalizeMarket } from "@/lib/markets";

export async function GET(req: NextRequest) {
  const market = normalizeMarket(req.nextUrl.searchParams.get("market"));

  const sectors = await prisma.sector.findMany({
    where: { market },
    orderBy: { name: "asc" },
    include: {
      etfs: { orderBy: { rank: "asc" } },
      _count: { select: { postSectors: true, stocks: true } },
    },
  });

  return NextResponse.json({
    sectors: sectors.map((sector) => ({
      id: sector.id,
      market: sector.market,
      slug: sector.slug,
      name: sector.name,
      description: sector.description,
      mentionCount: sector._count.postSectors,
      stockCount: sector._count.stocks,
      etfs: sector.etfs.map((etf) => ({
        ticker: etf.ticker,
        market: etf.market,
        name: etf.name,
        rationale: etf.rationale,
        rank: etf.rank,
      })),
    })),
  });
}
