import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { normalizeMarket } from "@/lib/markets";
import { classifyConfidence } from "@/lib/credibility";

/**
 * GET /api/bloggers/[username]?market=CN
 *
 * Returns detailed blogger profile:
 * - Aggregate and per-sector credibility scores
 * - Sector tag cloud (sectors they cover, with credibility scores)
 * - Recent prediction stats
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ username: string }> }
) {
  const { username } = await params;
  const market = normalizeMarket(req.nextUrl.searchParams.get("market"));

  const blogger = await prisma.blogger.findUnique({
    where: { xUsername: username },
    include: {
      credibility: {
        where: { market },
        include: {
          sector: { select: { slug: true, name: true, description: true } },
        },
        orderBy: { score: "desc" },
      },
    },
  });

  if (!blogger) {
    return NextResponse.json({ error: "Blogger not found" }, { status: 404 });
  }

  // Aggregate credibility
  const creds = blogger.credibility;
  const totalPredictions = creds.reduce((sum, c) => sum + c.totalPredictions, 0);
  const correctPredictions = creds.reduce(
    (sum, c) => sum + c.correctPredictions,
    0
  );

  const weightedScore =
    totalPredictions > 0
      ? creds.reduce(
          (sum, c) => sum + Number(c.score) * c.totalPredictions,
          0
        ) / totalPredictions
      : creds.length > 0
        ? creds.reduce((sum, c) => sum + Number(c.score), 0) / creds.length
        : 0;

  // Recent activity
  const recentPost = await prisma.post.findFirst({
    where: { bloggerId: blogger.id },
    orderBy: { postedAt: "desc" },
    select: { postedAt: true },
  });

  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);
  const recentPostCount = await prisma.post.count({
    where: {
      bloggerId: blogger.id,
      postedAt: { gte: thirtyDaysAgo },
    },
  });

  // Total opinion count with sentiment
  const totalOpinions = await prisma.postSector.count({
    where: {
      sentiment: { not: null },
      post: { bloggerId: blogger.id },
      sector: { market },
    },
  });

  // Total verified (backtested) opinions
  const verifiedOpinions = await prisma.opinionBacktest.count({
    where: {
      postSector: {
        post: { bloggerId: blogger.id },
        sector: { market },
      },
    },
  });

  // Sector tag cloud: size = prediction count in sector, color = credibility score
  const sectorCloud = creds.map((c) => ({
    slug: c.sector.slug,
    name: c.sector.name,
    score: Number(c.score),
    label: classifyConfidence(Number(c.score)),
    totalPredictions: c.totalPredictions,
    correctPredictions: c.correctPredictions,
    accuracyRate: c.accuracyRate ? Number(c.accuracyRate) : null,
  }));

  return NextResponse.json({
    id: blogger.id,
    xUsername: blogger.xUsername,
    displayName: blogger.displayName,
    color: blogger.color,
    avatarUrl: blogger.avatarUrl,
    market: blogger.market,
    credibility: {
      score: Math.round(weightedScore),
      label: classifyConfidence(Math.round(weightedScore)),
      totalPredictions,
      correctPredictions,
      sectorCount: creds.length,
    },
    stats: {
      totalPosts: await prisma.post.count({ where: { bloggerId: blogger.id } }),
      recentPostCount,
      totalOpinions,
      verifiedOpinions,
      lastActiveAt: recentPost?.postedAt ?? null,
    },
    sectorCloud,
  });
}
