import { prisma } from "@/lib/db";
import type { StockProfile } from "@/lib/yahoo";

export async function buildStockResponse(ticker: string): Promise<object | null> {
  const key = ticker.toUpperCase();

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

  if (!stock) return null;

  const profile = stock.profileData as StockProfile | null;

  return {
    ticker: stock.ticker,
    companyName: stock.companyName,
    latestPrice: stock.latestPrice,
    profile,
    analysis: stock.analysis?.content ?? null,
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
      const firstBar = stock.priceHistory.find((p) => p.date >= stock.createdAt);
      const firstPrice = firstBar ? Number(firstBar.close) : null;
      const latest = stock.latestPrice ? Number(stock.latestPrice) : null;
      if (firstPrice && latest && firstPrice > 0) {
        return ((latest - firstPrice) / firstPrice) * 100;
      }
      return null;
    })(),
    firstMentionDate: stock.createdAt.toISOString().slice(0, 10),
  };
}
