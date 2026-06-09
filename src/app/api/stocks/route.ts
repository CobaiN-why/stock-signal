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
          id: true,
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
  const etfTickers = stocks
    .filter((stock) => stock.assetType === "ETF")
    .map((stock) => stock.ticker);
  const mappedEtfs =
    etfTickers.length > 0
      ? await prisma.sectorEtf.findMany({
          where: { market, ticker: { in: etfTickers } },
          include: {
            sector: {
              select: {
                id: true,
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
        })
      : [];
  const mappedSectorsByTicker = new Map<string, typeof mappedEtfs>();
  for (const item of mappedEtfs) {
    const items = mappedSectorsByTicker.get(item.ticker) ?? [];
    items.push(item);
    mappedSectorsByTicker.set(item.ticker, items);
  }

  let filtered = stocks;
  if (filter === "has_price") {
    filtered = stocks.filter((s) => s.latestPrice !== null);
  } else if (filter === "high_freq") {
    filtered = stocks.filter((s) => s._count.postStocks >= 3);
  }

  const result = filtered.map((s) => {
    const sectorIds = new Set<string>();
    let sectorMentionCount = 0;
    const mappedSectors = mappedSectorsByTicker.get(s.ticker) ?? [];
    if (s.assetType === "ETF" && s.sector) {
      sectorIds.add(s.sector.id);
      sectorMentionCount += s.sector._count.postSectors;
    }
    if (s.assetType === "ETF") {
      for (const mapped of mappedSectors) {
        if (sectorIds.has(mapped.sector.id)) continue;
        sectorIds.add(mapped.sector.id);
        sectorMentionCount += mapped.sector._count.postSectors;
      }
    }
    const directMentionCount = s._count.postStocks;
    const totalMentionCount = directMentionCount + sectorMentionCount;
    const latestDirect = s.postStocks[0]?.post.postedAt ?? null;
    const mappedLatestSector =
      mappedSectors
        .map((mapped) => mapped.sector.postSectors[0]?.post.postedAt)
        .filter((date): date is Date => Boolean(date))
        .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
    const latestSector =
      s.sector?.postSectors[0]?.post.postedAt ?? mappedLatestSector;
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
