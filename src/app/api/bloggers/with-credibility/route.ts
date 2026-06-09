import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { normalizeMarket } from "@/lib/markets";
import { classifyConfidence } from "@/lib/credibility";

/**
 * GET /api/bloggers/with-credibility?market=CN
 *
 * Returns all active bloggers sorted by aggregate credibility score (desc).
 * Each blogger includes their sector expertise summary.
 */
export async function GET(req: NextRequest) {
  const market = normalizeMarket(req.nextUrl.searchParams.get("market"));

  const bloggers = await prisma.blogger.findMany({
    where: { isActive: true },
    include: {
      credibility: {
        where: { market },
        include: {
          sector: { select: { slug: true, name: true } },
        },
        orderBy: { score: "desc" },
      },
      _count: { select: { posts: true } },
    },
  });

  const result = await Promise.all(
    bloggers.map(async (blogger) => {
      // Calculate aggregate credibility
      const creds = blogger.credibility;
      const totalPredictions = creds.reduce(
        (sum, c) => sum + c.totalPredictions,
        0
      );
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
            ? creds.reduce((sum, c) => sum + Number(c.score), 0) /
              creds.length
            : 0;

      const accuracyRate =
        totalPredictions > 0
          ? Math.round((correctPredictions / totalPredictions) * 100)
          : null;

      // Get recent activity
      const recentPost = await prisma.post.findFirst({
        where: { bloggerId: blogger.id },
        orderBy: { postedAt: "desc" },
        select: { postedAt: true },
      });

      // Count posts in last 30 days
      const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);
      const recentPostCount = await prisma.post.count({
        where: {
          bloggerId: blogger.id,
          postedAt: { gte: thirtyDaysAgo },
        },
      });

      return {
        id: blogger.id,
        xUsername: blogger.xUsername,
        displayName: blogger.displayName,
        color: blogger.color,
        avatarUrl: blogger.avatarUrl,
        market: blogger.market,
        credibility: {
          score: Math.round(weightedScore),
          label: classifyConfidence(Math.round(weightedScore)),
          accuracyRate,
          totalPredictions,
          correctPredictions,
        },
        topSectors: creds.slice(0, 5).map((c) => ({
          slug: c.sector.slug,
          name: c.sector.name,
          score: Number(c.score),
        })),
        totalPosts: blogger._count.posts,
        recentPostCount,
        lastActiveAt: recentPost?.postedAt ?? null,
      };
    })
  );

  // Sort by credibility score descending
  result.sort((a, b) => b.credibility.score - a.credibility.score);

  return NextResponse.json(result);
}
