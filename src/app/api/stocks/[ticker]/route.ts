import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import type { StockProfile } from "@/lib/yahoo";

const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12h — data only updates once per day via cron

// In-memory response cache — cleared on server restart (deploy), so long TTL is safe
const responseCache = new Map<string, { data: object; ts: number }>();

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker } = await params;
  const key = ticker.toUpperCase();

  // --- In-memory cache: return instantly if <60s old ---
  const cached = responseCache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return NextResponse.json(cached.data);
  }

  const stock = await prisma.stock.findUnique({
    where: { ticker: key },
    include: {
      priceHistory: { orderBy: { date: "asc" } },
      postStocks: {
        include: { post: { include: { blogger: true } } },
        orderBy: { post: { postedAt: "desc" } },
      },
      analysis: true,
    },
  });

  if (!stock) {
    return NextResponse.json({ error: "Stock not found" }, { status: 404 });
  }

  const profile = stock.profileData as StockProfile | null;
  const analysisContent = stock.analysis?.content ?? null;

  const response = {
    ticker: stock.ticker,
    companyName: stock.companyName,
    latestPrice: stock.latestPrice,
    profile,
    analysis: analysisContent,
    mentions: stock.postStocks.map((ps) => ({
      id: ps.id,
      mentionType: ps.mentionType,
      sentiment: ps.sentiment,
      post: {
        id: ps.post.id,
        content: ps.post.content,
        postedAt: ps.post.postedAt,
        url: ps.post.url,
        blogger: {
          xUsername: ps.post.blogger.xUsername,
          displayName: ps.post.blogger.displayName,
          color: ps.post.blogger.color,
          avatarUrl: ps.post.blogger.avatarUrl,
        },
      },
    })),
    prices: stock.priceHistory.map((p) => ({
      date: p.date,
      open: Number(p.open),
      high: Number(p.high),
      low: Number(p.low),
      close: Number(p.close),
      volume: Number(p.volume),
    })),
    cumulativeReturn: (() => {
      const mentionDate = stock.createdAt;
      const firstBar = stock.priceHistory.find(
        (p) => p.date >= mentionDate
      );
      const firstPrice = firstBar ? Number(firstBar.close) : null;
      const latest = stock.latestPrice ? Number(stock.latestPrice) : null;
      if (firstPrice && latest && firstPrice > 0) {
        return ((latest - firstPrice) / firstPrice) * 100;
      }
      return null;
    })(),
    firstMentionDate: stock.createdAt.toISOString().slice(0, 10),
  };

  responseCache.set(key, { data: response, ts: Date.now() });

  return NextResponse.json(response);
}
