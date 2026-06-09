import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { normalizeMarket } from "@/lib/markets";

export async function GET(req: NextRequest) {
  const filter = req.nextUrl.searchParams.get("filter");
  const market = normalizeMarket(req.nextUrl.searchParams.get("market"));

  const stocks = await prisma.stock.findMany({
    where: { market },
    include: {
      _count: { select: { postStocks: true } },
      postStocks: {
        select: {
          post: { select: { postedAt: true } },
        },
        orderBy: { post: { postedAt: "desc" } },
        take: 1,
      },
      sector: {
        select: {
          _count: { select: { postSectors: true } },
          postSectors: {
            select: {
              post: { select: { postedAt: true } },
            },
            orderBy: { post: { postedAt: "desc" } },
            take: 1,
          },
        },
      },
    },
    orderBy: [
      { assetType: "asc" },
      { postStocks: { _count: "desc" } },
      { ticker: "asc" },
    ],
  });

  let filtered = stocks;
  if (filter === "has_price") {
    filtered = stocks.filter((s) => s.latestPrice !== null);
  } else if (filter === "high_freq") {
    filtered = stocks.filter((s) => s._count.postStocks >= 3);
  }

  const result = filtered.map((s) => {
    const sectorMentionCount =
      s.assetType === "ETF" ? (s.sector?._count.postSectors ?? 0) : 0;
    const directMentionCount = s._count.postStocks;
    const totalMentionCount = directMentionCount + sectorMentionCount;
    const latestDirect = s.postStocks[0]?.post.postedAt ?? null;
    const latestSector = s.sector?.postSectors[0]?.post.postedAt ?? null;
    const lastMentionedAt =
      latestDirect && latestSector
        ? latestDirect > latestSector
          ? latestDirect
          : latestSector
        : latestDirect ?? latestSector;

    return {
      id: s.id,
      ticker: s.ticker,
      market: s.market,
      assetType: s.assetType,
      currency: s.currency,
      companyName: s.companyName,
      latestPrice: s.latestPrice,
      priceUpdatedAt: s.priceUpdatedAt,
      createdAt: s.createdAt,
      lastMentionedAt,
      mentionCount: totalMentionCount,
      directMentionCount,
      sectorMentionCount,
      _count: s._count,
    };
  });

  return NextResponse.json(result);
}
