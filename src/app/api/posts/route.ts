import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { normalizeMarket } from "@/lib/markets";

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

    where.OR = [
      {
        postStocks: {
          some: { stock: { ticker: ticker.toUpperCase(), market } },
        },
      },
      ...(stock?.assetType === "ETF" && stock.sectorId
        ? [{ postSectors: { some: { sectorId: stock.sectorId } } }]
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
          include: { stock: { select: { ticker: true, market: true } } },
        },
        postSectors: {
          include: {
            sector: { select: { slug: true, name: true, market: true } },
          },
        },
      },
    }),
    prisma.post.count({ where }),
  ]);

  return NextResponse.json({ posts, total, limit, offset });
}
