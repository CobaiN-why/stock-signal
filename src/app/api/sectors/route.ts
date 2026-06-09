import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { normalizeMarket } from "@/lib/markets";

export async function GET(req: NextRequest) {
  const market = normalizeMarket(req.nextUrl.searchParams.get("market"));
  const includeEmpty = req.nextUrl.searchParams.get("includeEmpty") === "true";
  const daysParam = Number(req.nextUrl.searchParams.get("days") ?? "30");
  const days = Number.isFinite(daysParam) && daysParam > 0 ? daysParam : 30;
  const since = new Date(Date.now() - days * 86400000);

  const sectors = await prisma.sector.findMany({
    where: {
      market,
      ...(includeEmpty
        ? {}
        : { postSectors: { some: { post: { postedAt: { gte: since } } } } }),
    },
    orderBy: [
      { postSectors: { _count: "desc" } },
      { name: "asc" },
    ],
    include: {
      etfs: { orderBy: { rank: "asc" } },
      postSectors: {
        where: includeEmpty ? {} : { post: { postedAt: { gte: since } } },
        orderBy: { post: { postedAt: "desc" } },
        include: {
          post: {
            select: {
              id: true,
              postedAt: true,
              url: true,
              content: true,
              blogger: {
                select: {
                  xUsername: true,
                  displayName: true,
                  color: true,
                },
              },
            },
          },
        },
      },
      _count: { select: { postSectors: true, stocks: true } },
    },
  });

  return NextResponse.json({
    days,
    includeEmpty,
    sectors: sectors.map((sector) => {
      const directCount = sector.postSectors.filter(
        (ps) => Number(ps.confidence) >= 0.7
      ).length;
      const inferredCount = sector.postSectors.filter(
        (ps) => Number(ps.confidence) < 0.7
      ).length;
      const bullishCount = sector.postSectors.filter(
        (ps) => ps.sentiment === "bullish"
      ).length;
      const bearishCount = sector.postSectors.filter(
        (ps) => ps.sentiment === "bearish"
      ).length;

      return {
        id: sector.id,
        market: sector.market,
        slug: sector.slug,
        name: sector.name,
        description: sector.description,
        mentionCount: sector.postSectors.length,
        directCount,
        inferredCount,
        bullishCount,
        bearishCount,
        stockCount: sector._count.stocks,
        recentOpinions: sector.postSectors.slice(0, 8).map((ps) => ({
          id: ps.id,
          confidence: Number(ps.confidence),
          evidence: ps.evidence,
          sentiment: ps.sentiment,
          post: {
            id: ps.post.id,
            postedAt: ps.post.postedAt,
            url: ps.post.url,
            content: ps.post.content,
            blogger: ps.post.blogger,
          },
        })),
        etfs: sector.etfs.map((etf) => ({
          ticker: etf.ticker,
          market: etf.market,
          name: etf.name,
          rationale: etf.rationale,
          rank: etf.rank,
        })),
      };
    }),
  });
}
