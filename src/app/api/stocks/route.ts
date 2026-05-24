import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(req: NextRequest) {
  const filter = req.nextUrl.searchParams.get("filter");

  const stocks = await prisma.stock.findMany({
    include: {
      _count: { select: { postStocks: true } },
      postStocks: {
        select: {
          post: { select: { postedAt: true } },
        },
        orderBy: { post: { postedAt: "desc" } },
        take: 1,
      },
    },
    orderBy: { postStocks: { _count: "desc" } },
  });

  let filtered = stocks;
  if (filter === "has_price") {
    filtered = stocks.filter((s) => s.latestPrice !== null);
  } else if (filter === "high_freq") {
    filtered = stocks.filter((s) => s._count.postStocks >= 3);
  }

  const result = filtered.map((s) => ({
    id: s.id,
    ticker: s.ticker,
    companyName: s.companyName,
    latestPrice: s.latestPrice,
    priceUpdatedAt: s.priceUpdatedAt,
    createdAt: s.createdAt,
    lastMentionedAt: s.postStocks[0]?.post.postedAt ?? null,
    _count: s._count,
  }));

  return NextResponse.json(result);
}
