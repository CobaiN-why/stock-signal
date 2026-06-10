import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { normalizeMarket } from "@/lib/markets";
import { buildPostMappings } from "@/lib/post-mappings";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const ticker = searchParams.get("ticker");
  const blogger = searchParams.get("blogger");
  const market = normalizeMarket(searchParams.get("market"));
  const limit = parseInt(searchParams.get("limit") || "50", 10);
  const offset = parseInt(searchParams.get("offset") || "0", 10);

  const where: Record<string, unknown> = {};

  if (ticker) {
    const stock = await prisma.stock.findUnique({
      where: { market_ticker: { market, ticker: ticker.toUpperCase() } },
      select: { assetType: true, sectorId: true },
    });
    const mappedSectorEtfs =
      stock?.assetType === "ETF"
        ? await prisma.sectorEtf.findMany({
            where: { market, ticker: ticker.toUpperCase() },
            select: { sectorId: true },
          })
        : [];
    const sectorIds = Array.from(
      new Set([
        ...(stock?.sectorId ? [stock.sectorId] : []),
        ...mappedSectorEtfs.map((etf) => etf.sectorId),
      ])
    );

    where.OR = [
      {
        postStocks: {
          some: { stock: { ticker: ticker.toUpperCase(), market } },
        },
      },
      ...(stock?.assetType === "ETF" && sectorIds.length > 0
        ? [{ postSectors: { some: { sectorId: { in: sectorIds } } } }]
        : []),
    ];
  }
  if (blogger) {
    where.blogger = { xUsername: blogger };
  }

  const [posts, total] = await Promise.all([
    prisma.post.findMany({
      where,
      orderBy: { postedAt: "desc" },
      take: limit,
      skip: offset,
      include: {
        blogger: {
          select: {
            xUsername: true,
            displayName: true,
            color: true,
            avatarUrl: true,
          },
        },
        postStocks: {
          select: {
            mentionType: true,
            sentiment: true,
            stock: {
              select: {
                ticker: true,
                market: true,
                assetType: true,
                companyName: true,
              },
            },
          },
        },
        postSectors: {
          include: {
            sector: {
              select: {
                id: true,
                slug: true,
                name: true,
                market: true,
                etfs: {
                  orderBy: { rank: "asc" },
                  take: 5,
                  select: {
                    ticker: true,
                    market: true,
                    name: true,
                    rank: true,
                  },
                },
              },
            },
          },
        },
      },
    }),
    prisma.post.count({ where }),
  ]);

  return NextResponse.json({
    posts: posts.map((post) => ({
      ...post,
      mappings: buildPostMappings(post),
    })),
    total,
    limit,
    offset,
  });
}
