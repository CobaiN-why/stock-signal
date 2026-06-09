import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { normalizeMarket } from "@/lib/markets";
import { classifyConfidence } from "@/lib/credibility";

/**
 * GET /api/sectors/[slug]?market=CN&days=30
 *
 * Returns detailed sector data for the drill-down panel:
 * - Sentiment trend time series (daily bull/bear ratios)
 * - Credibility-weighted signal strength
 * - Top bloggers with credibility scores and avatars
 * - Recent opinions with backtest results
 * - Associated ETF recommendations
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const market = normalizeMarket(req.nextUrl.searchParams.get("market"));
  const daysParam = Number(req.nextUrl.searchParams.get("days") ?? "30");
  const days = Number.isFinite(daysParam) && daysParam > 0 ? daysParam : 30;
  const since = new Date(Date.now() - days * 86400000);

  const sector = await prisma.sector.findUnique({
    where: { market_slug: { market, slug } },
    include: {
      etfs: { orderBy: { rank: "asc" } },
      postSectors: {
        where: { post: { postedAt: { gte: since } } },
        orderBy: { post: { postedAt: "desc" } },
        include: {
          post: {
            select: {
              id: true,
              content: true,
              postedAt: true,
              url: true,
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
          backtests: { take: 1 },
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
      },
    },
  });

  if (!sector) {
    return NextResponse.json({ error: "Sector not found" }, { status: 404 });
  }

  // --- Sentiment trend: daily bull/bear counts over the lookback window ---
  const trendMap = new Map<string, { bullish: number; bearish: number }>();
  for (const ps of sector.postSectors) {
    if (!ps.sentiment) continue;
    const dateKey = ps.post.postedAt.toISOString().slice(0, 10);
    if (!trendMap.has(dateKey)) {
      trendMap.set(dateKey, { bullish: 0, bearish: 0 });
    }
    const entry = trendMap.get(dateKey)!;
    if (ps.sentiment === "bullish") entry.bullish++;
    else if (ps.sentiment === "bearish") entry.bearish++;
  }

  // Build full date range filled with zeros
  const trend: { date: string; bullish: number; bearish: number; ratio: number | null }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    const dateKey = d.toISOString().slice(0, 10);
    const entry = trendMap.get(dateKey) ?? { bullish: 0, bearish: 0 };
    const total = entry.bullish + entry.bearish;
    trend.push({
      date: dateKey,
      bullish: entry.bullish,
      bearish: entry.bearish,
      ratio: total > 0 ? Math.round((entry.bullish / total) * 100) : null,
    });
  }

  // --- Credibility-weighted signal ---
  const credMap = new Map(
    sector.credibility.map((c) => [c.bloggerId, Number(c.score)])
  );

  let weightedBullish = 0;
  let weightedBearish = 0;
  let totalWeight = 0;

  for (const ps of sector.postSectors) {
    if (!ps.sentiment) continue;
    const cred = credMap.get(ps.post.blogger.id) ?? 50;
    const weight = cred / 100;
    totalWeight += weight;
    if (ps.sentiment === "bullish") weightedBullish += weight;
    else if (ps.sentiment === "bearish") weightedBearish += weight;
  }

  const signalStrength =
    totalWeight > 0
      ? Math.round(50 + ((weightedBullish - weightedBearish) / totalWeight) * 50)
      : 50;

  // --- Recent opinions with backtest results ---
  const recentOpinions = sector.postSectors.slice(0, 20).map((ps) => ({
    id: ps.id,
    sentiment: ps.sentiment,
    confidence: Number(ps.confidence),
    evidence: ps.evidence,
    post: {
      id: ps.post.id,
      content: ps.post.content.slice(0, 300),
      postedAt: ps.post.postedAt,
      url: ps.post.url,
      blogger: ps.post.blogger,
    },
    backtest: ps.backtests[0]
      ? {
          result: ps.backtests[0].result,
          returnPct: Number(ps.backtests[0].returnPct),
          windowDays: ps.backtests[0].windowDays,
          priceBefore: Number(ps.backtests[0].priceBefore),
          priceAfter: Number(ps.backtests[0].priceAfter),
        }
      : null,
  }));

  // --- Stats ---
  const bullishCount = sector.postSectors.filter(
    (ps) => ps.sentiment === "bullish"
  ).length;
  const bearishCount = sector.postSectors.filter(
    (ps) => ps.sentiment === "bearish"
  ).length;

  return NextResponse.json({
    id: sector.id,
    slug: sector.slug,
    name: sector.name,
    description: sector.description,
    stats: {
      mentionCount: sector.postSectors.length,
      bullishCount,
      bearishCount,
    },
    signalStrength,
    confidenceLabel: classifyConfidence(Math.abs(signalStrength - 50) * 2),
    trend,
    topBloggers: sector.credibility.map((c) => ({
      xUsername: c.blogger.xUsername,
      displayName: c.blogger.displayName,
      color: c.blogger.color,
      score: Number(c.score),
      accuracyRate: c.accuracyRate ? Number(c.accuracyRate) : null,
      totalPredictions: c.totalPredictions,
    })),
    etfs: sector.etfs.map((e) => ({
      ticker: e.ticker,
      market: e.market,
      name: e.name,
      rationale: e.rationale,
      rank: e.rank,
    })),
    recentOpinions,
  });
}
