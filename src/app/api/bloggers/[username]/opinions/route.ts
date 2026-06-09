import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { normalizeMarket } from "@/lib/markets";

/**
 * GET /api/bloggers/[username]/opinions?market=CN&sector=xxx&limit=20&offset=0
 *
 * Returns paginated opinion history for a blogger, each with backtest verification.
 * Supports filtering by sector slug.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ username: string }> }
) {
  const { username } = await params;
  const market = normalizeMarket(req.nextUrl.searchParams.get("market"));
  const sectorSlug = req.nextUrl.searchParams.get("sector") ?? undefined;
  const limitParam = Number(req.nextUrl.searchParams.get("limit") ?? "20");
  const limit = Math.min(Number.isFinite(limitParam) ? limitParam : 20, 50);
  const offsetParam = Number(req.nextUrl.searchParams.get("offset") ?? "0");
  const offset = Number.isFinite(offsetParam) ? offsetParam : 0;

  const blogger = await prisma.blogger.findUnique({
    where: { xUsername: username },
  });

  if (!blogger) {
    return NextResponse.json({ error: "Blogger not found" }, { status: 404 });
  }

  const whereClause: Record<string, unknown> = {
    sentiment: { not: null },
    post: { bloggerId: blogger.id },
    sector: { market },
  };

  if (sectorSlug) {
    whereClause.sector = { market, slug: sectorSlug };
  }

  const [opinions, total] = await Promise.all([
    prisma.postSector.findMany({
      where: whereClause,
      orderBy: { post: { postedAt: "desc" } },
      take: limit,
      skip: offset,
      include: {
        post: {
          select: {
            id: true,
            content: true,
            postedAt: true,
            url: true,
          },
        },
        sector: {
          select: {
            slug: true,
            name: true,
            etfs: { orderBy: { rank: "asc" }, take: 1 },
          },
        },
        backtests: { take: 1 },
      },
    }),
    prisma.postSector.count({ where: whereClause }),
  ]);

  const result = opinions.map((ps) => ({
    id: ps.id,
    sentiment: ps.sentiment,
    confidence: Number(ps.confidence),
    evidence: ps.evidence,
    post: {
      id: ps.post.id,
      content: ps.post.content.slice(0, 300),
      postedAt: ps.post.postedAt,
      url: ps.post.url,
    },
    sector: {
      slug: ps.sector.slug,
      name: ps.sector.name,
      primaryEtf:
        ps.sector.etfs.length > 0
          ? {
              ticker: ps.sector.etfs[0].ticker,
              market: ps.sector.etfs[0].market,
            }
          : null,
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

  return NextResponse.json({
    opinions: result,
    total,
    limit,
    offset,
  });
}
