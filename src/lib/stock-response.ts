import { prisma } from "@/lib/db";
import { DEFAULT_MARKET, normalizeMarket } from "@/lib/markets";
import type { StockProfile } from "@/lib/market-data";

export const STOCK_RESPONSE_SCHEMA_VERSION = 2;

export async function buildStockResponse(
  ticker: string,
  marketValue: string | null | undefined = DEFAULT_MARKET
): Promise<object | null> {
  const key = ticker.toUpperCase();
  const market = normalizeMarket(marketValue);

  const stock = await prisma.stock.findUnique({
    where: { market_ticker: { market, ticker: key } },
    include: {
      priceHistory: { orderBy: { date: "asc" } },
      postStocks: {
        include: { post: { include: { blogger: true } } },
        orderBy: { post: { postedAt: "desc" } },
      },
      sector: {
        include: {
          etfs: { orderBy: { rank: "asc" } },
          postSectors: {
            include: { post: { include: { blogger: true } } },
            orderBy: { post: { postedAt: "desc" } },
          },
        },
      },
      analysis: true,
    },
  });

  if (!stock) return null;

  const profile = stock.profileData as StockProfile | null;

  const directMentions = stock.postStocks.map((ps) => ({
    id: ps.id,
    mentionType: ps.mentionType,
    associationType: "direct_stock",
    confidence: 1,
    evidence: ps.mentionType,
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
  }));

  const directPostIds = new Set(directMentions.map((m) => m.post.id));
  const sectorMentions =
    stock.assetType === "ETF" && stock.sector
      ? stock.sector.postSectors
          .filter((ps) => !directPostIds.has(ps.post.id))
          .map((ps) => ({
            id: `sector:${ps.id}`,
            mentionType: "sector",
            associationType:
              Number(ps.confidence) >= 0.7 ? "direct_sector" : "inferred_sector",
            confidence: Number(ps.confidence),
            evidence: ps.evidence,
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
          }))
      : [];

  return {
    schemaVersion: STOCK_RESPONSE_SCHEMA_VERSION,
    ticker: stock.ticker,
    market: stock.market,
    assetType: stock.assetType,
    currency: stock.currency,
    companyName: stock.companyName,
    latestPrice: stock.latestPrice,
    profile,
    analysis: stock.analysis?.content ?? null,
    sector: stock.sector
      ? {
          slug: stock.sector.slug,
          name: stock.sector.name,
          description: stock.sector.description,
          etfs: stock.sector.etfs.map((etf) => ({
            ticker: etf.ticker,
            market: etf.market,
            name: etf.name,
            rationale: etf.rationale,
            rank: etf.rank,
          })),
        }
      : null,
    mentions: [...directMentions, ...sectorMentions].sort(
      (a, b) =>
        new Date(b.post.postedAt).getTime() -
        new Date(a.post.postedAt).getTime()
    ),
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
