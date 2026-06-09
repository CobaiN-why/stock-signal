import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { normalizeMarket } from "@/lib/markets";
import { classifyConfidence } from "@/lib/credibility";

/**
 * GET /api/sectors/overview?market=CN&days=30
 *
 * Returns sector sentiment overview for the signal overview heatmap.
 * Each sector gets aggregated sentiment, signal strength score,
 * and top high-credibility bloggers.
 */
export async function GET(req: NextRequest) {
  const market = normalizeMarket(req.nextUrl.searchParams.get("market"));
  const daysParam = Number(req.nextUrl.searchParams.get("days") ?? "30");
  const days = Number.isFinite(daysParam) && daysParam > 0 ? daysParam : 30;
  const since = new Date(Date.now() - days * 86400000);

  const sectors = await prisma.sector.findMany({
    where: {
      market,
      postSectors: { some: { post: { postedAt: { gte: since } } } },
    },
    include: {
      etfs: { orderBy: { rank: "asc" }, take: 3 },
      postSectors: {
        where: { post: { postedAt: { gte: since } } },
        include: {
          post: {
            select: {
              id: true,
              postedAt: true,
              blogger: {
                select: {
                  id: true,
                  xUsername: true,
                  displayName: true,
                  color: true,
                },
              },
            },
          },
        },
      },
      credibility: {
        include: {
          blogger: {
            select: {
              xUsername: true,
              displayName: true,
              color: true,
            },
          },
        },
        orderBy: { score: "desc" },
        take: 5,
      },
      _count: { select: { postSectors: true } },
    },
    orderBy: [{ postSectors: { _count: "desc" } }, { name: "asc" }],
  });

  const result = sectors.map((sector) => {
    const postSectors = sector.postSectors;
    const bullishCount = postSectors.filter(
      (ps) => ps.sentiment === "bullish"
    ).length;
    const bearishCount = postSectors.filter(
      (ps) => ps.sentiment === "bearish"
    ).length;
    const totalWithSentiment = bullishCount + bearishCount;

    // Calculate credibility-weighted signal strength
    const credMap = new Map(
      sector.credibility.map((c) => [c.bloggerId, Number(c.score)])
    );

    let weightedBullish = 0;
    let weightedBearish = 0;
    let totalWeight = 0;

    for (const ps of postSectors) {
      if (!ps.sentiment) continue;
      const cred = credMap.get(ps.post.blogger.id) ?? 50; // default 50 for unknown
      const weight = cred / 100;
      totalWeight += weight;
      if (ps.sentiment === "bullish") weightedBullish += weight;
      else if (ps.sentiment === "bearish") weightedBearish += weight;
    }

    // Signal strength: 0-100, where 50 = neutral, >50 = bullish, <50 = bearish
    const signalStrength =
      totalWeight > 0
        ? Math.round(50 + ((weightedBullish - weightedBearish) / totalWeight) * 50)
        : 50;

    // Latest trend: compare last 7 days vs previous 7 days
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000);
    const fourteenDaysAgo = new Date(Date.now() - 14 * 86400000);

    const recent = postSectors.filter(
      (ps) => ps.post.postedAt >= sevenDaysAgo && ps.sentiment
    );
    const older = postSectors.filter(
      (ps) =>
        ps.post.postedAt >= fourteenDaysAgo &&
        ps.post.postedAt < sevenDaysAgo &&
        ps.sentiment
    );

    const recentBullish = recent.filter(
      (ps) => ps.sentiment === "bullish"
    ).length;
    const recentBearish = recent.filter(
      (ps) => ps.sentiment === "bearish"
    ).length;
    const olderBullish = older.filter(
      (ps) => ps.sentiment === "bullish"
    ).length;
    const olderBearish = older.filter(
      (ps) => ps.sentiment === "bearish"
    ).length;

    const recentRatio =
      recentBullish + recentBearish > 0
        ? recentBullish / (recentBullish + recentBearish)
        : null;
    const olderRatio =
      olderBullish + olderBearish > 0
        ? olderBullish / (olderBullish + olderBearish)
        : null;

    let trend: "up" | "down" | "stable" = "stable";
    if (recentRatio !== null && olderRatio !== null) {
      if (recentRatio - olderRatio > 0.1) trend = "up";
      else if (olderRatio - recentRatio > 0.1) trend = "down";
    }

    return {
      id: sector.id,
      slug: sector.slug,
      name: sector.name,
      description: sector.description,
      mentionCount: postSectors.length,
      bullishCount,
      bearishCount,
      bullBearRatio:
        totalWithSentiment > 0
          ? Math.round((bullishCount / totalWithSentiment) * 100)
          : null,
      signalStrength,
      confidenceLabel: classifyConfidence(
        Math.abs(signalStrength - 50) * 2
      ),
      trend,
      topBloggers: sector.credibility.slice(0, 5).map((c) => ({
        xUsername: c.blogger.xUsername,
        displayName: c.blogger.displayName,
        color: c.blogger.color,
        score: Number(c.score),
      })),
      primaryEtf:
        sector.etfs.length > 0
          ? {
              ticker: sector.etfs[0].ticker,
              market: sector.etfs[0].market,
              name: sector.etfs[0].name,
            }
          : null,
    };
  });

  return NextResponse.json({ days, market, sectors: result });
}
