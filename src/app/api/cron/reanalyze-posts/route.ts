import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyCronAuth } from "@/lib/cron-auth";
import { detectSentiment } from "@/lib/sentiment";
import { analyzeSectorsAndSentiment } from "@/lib/sector-ai";
import { inferSectorsFromStockMention } from "@/lib/stock-sector-mapping";
import type { StockMention } from "@/lib/stock-identifier";
import type { AssetType } from "@/lib/markets";
import { fetchDailyBars } from "@/lib/market-data";
import { normalizeMarket } from "@/lib/markets";

/**
 * POST /api/cron/reanalyze-posts
 *
 * Re-runs sector identification on EXISTING posts (no Twitter fetch).
 * Uses the new unified AI pipeline: analyzeSectorsAndSentiment().
 * Useful after adding new keywords or changing mapping logic.
 */
export async function POST(req: NextRequest) {
  const authError = verifyCronAuth(req);
  if (authError) return authError;

  const limit = Number(req.nextUrl.searchParams.get("limit") ?? "500");
  const since = req.nextUrl.searchParams.get("since");

  const where: Record<string, unknown> = {};
  if (since) {
    where.postedAt = { gte: new Date(since) };
  }

  const posts = await prisma.post.findMany({
    where,
    include: {
      postStocks: {
        include: {
          stock: {
            select: {
              id: true,
              ticker: true,
              market: true,
              assetType: true,
            },
          },
        },
      },
    },
    orderBy: { postedAt: "desc" },
    take: limit,
  });

  let sectorMentions = 0;
  let postsWithSectors = 0;

  for (const post of posts) {
    // Delete existing PostSector records for this post
    await prisma.postSector.deleteMany({ where: { postId: post.id } });

    // Build stock mentions from existing postStocks
    const stockMentions: StockMention[] = post.postStocks.map((ps) => ({
      ticker: ps.stock.ticker,
      market: ps.stock.market as "US" | "CN",
      assetType: (ps.stock.assetType || "STOCK") as AssetType,
      type: "keyword", // re-analyze uses keyword type since we don't know the original
    }));

    if (stockMentions.length === 0) continue;

    // ── AI unified analysis ──
    const aiResults = await analyzeSectorsAndSentiment(
      post.content,
      stockMentions
    );

    const sectorMentionsById = new Map<
      string,
      {
        sectorId: string;
        market: string;
        name: string;
        evidence: string;
        confidence: number;
        sentiment: string | null;
        sentimentTarget?: string;
      }
    >();

    // Collect AI sector mappings
    const aiByStock = new Map<string, (typeof aiResults)[number]>();
    const aiDirectSectors = new Map<string, (typeof aiResults)[number]>();
    for (const r of aiResults) {
      if (r.ticker && r.market) {
        aiByStock.set(`${r.market}:${r.ticker}`, r);
      } else {
        const existing = aiDirectSectors.get(r.sectorSlug);
        if (!existing || existing.confidence < r.confidence) {
          aiDirectSectors.set(r.sectorSlug, r);
        }
      }
    }

    for (const ps of post.postStocks) {
      const stockKey = `${ps.stock.market}:${ps.stock.ticker}`;
      const aiResult = aiByStock.get(stockKey);

      if (aiResult) {
        const sector = await prisma.sector.findUnique({
          where: {
            market_slug: { market: "CN", slug: aiResult.sectorSlug },
          },
          select: { id: true, name: true },
        });
        if (sector && !sectorMentionsById.has(sector.id)) {
          sectorMentionsById.set(sector.id, {
            sectorId: sector.id,
            market: "CN",
            name: aiResult.sectorName,
            evidence: aiResult.evidence,
            confidence: aiResult.confidence,
            sentiment: aiResult.sectorSentiment,
            sentimentTarget: ps.stock.ticker,
          });
        }
      } else {
        // DB fallback for stocks AI didn't map
        const dbSectors = await inferSectorsFromStockMention(
          ps.stockId,
          ps.stock.ticker,
          ps.stock.market,
          ps.stock.assetType as AssetType
        );
        for (const s of dbSectors) {
          const sentiment =
            s.sentiment ?? (await detectSentiment(post.content, s.name));
          if (!sectorMentionsById.has(s.sectorId)) {
            sectorMentionsById.set(s.sectorId, {
              sectorId: s.sectorId,
              market: s.market,
              name: s.name,
              evidence: s.evidence,
              confidence: s.confidence,
              sentiment,
              sentimentTarget: s.sentimentTarget,
            });
          }
        }
      }
    }

    // Direct sector mentions from AI
    for (const [slug, aiResult] of aiDirectSectors) {
      const sector = await prisma.sector.findUnique({
        where: { market_slug: { market: "CN", slug } },
        select: { id: true, name: true },
      });
      if (sector && !sectorMentionsById.has(sector.id)) {
        sectorMentionsById.set(sector.id, {
          sectorId: sector.id,
          market: "CN",
          name: aiResult.sectorName,
          evidence: aiResult.evidence,
          confidence: aiResult.confidence,
          sentiment: aiResult.sectorSentiment,
        });
      }
    }

    // CN ETF DB supplement
    for (const ps of post.postStocks) {
      if (
        ps.stock.assetType !== "ETF" ||
        ps.stock.market !== "CN" ||
        aiByStock.has(`${ps.stock.market}:${ps.stock.ticker}`)
      )
        continue;

      const dbSectors = await inferSectorsFromStockMention(
        ps.stockId,
        ps.stock.ticker,
        ps.stock.market,
        "ETF"
      );
      for (const s of dbSectors) {
        if (sectorMentionsById.has(s.sectorId)) continue;
        const sentiment =
          s.sentiment ?? (await detectSentiment(post.content, s.name));
        sectorMentionsById.set(s.sectorId, {
          sectorId: s.sectorId,
          market: s.market,
          name: s.name,
          evidence: s.evidence,
          confidence: s.confidence,
          sentiment,
        });
      }
    }

    // Write PostSectors
    for (const [, sector] of sectorMentionsById) {
      await prisma.postSector.create({
        data: {
          postId: post.id,
          sectorId: sector.sectorId,
          confidence: sector.confidence,
          evidence: sector.evidence,
          sentiment: sector.sentiment,
        },
      });
      sectorMentions++;
    }

    // Auto-sync missing ETF price data (fire-and-forget)
    syncMissingEtfPrices(sectorMentionsById).catch(() => {});

    if (sectorMentionsById.size > 0) postsWithSectors++;
  }

  return NextResponse.json({
    posts: posts.length,
    postsWithSectors,
    sectorMentions,
  });
}

async function syncMissingEtfPrices(
  sectorMentionsById: Map<string, { sectorId: string }>
) {
  const sectorIds = Array.from(sectorMentionsById.keys());
  if (sectorIds.length === 0) return;

  const etfs = await prisma.sectorEtf.findMany({
    where: { sectorId: { in: sectorIds } },
    select: { ticker: true, market: true },
  });

  for (const etf of etfs) {
    const stock = await prisma.stock.findUnique({
      where: { market_ticker: { market: etf.market, ticker: etf.ticker } },
      select: { id: true },
    });
    if (!stock) continue;

    const barCount = await prisma.priceHistory.count({
      where: { stockId: stock.id },
    });
    if (barCount > 0) continue;

    fetchDailyBars(
      { ticker: etf.ticker, market: normalizeMarket(etf.market), assetType: "ETF" },
      new Date(Date.now() - 180 * 86400000),
      new Date()
    )
      .then(async (bars) => {
        for (const bar of bars) {
          await prisma.priceHistory.upsert({
            where: { stockId_date: { stockId: stock.id, date: bar.date } },
            update: { open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume },
            create: { stockId: stock.id, date: bar.date, open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume },
          }).catch(() => {});
        }
      })
      .catch(() => {});
  }
}
