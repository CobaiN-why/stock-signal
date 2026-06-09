import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyCronAuth } from "@/lib/cron-auth";
import { detectSentiment } from "@/lib/sentiment";
import {
  identifySectorsAcrossMarkets,
  type SectorMention,
} from "@/lib/sector-identifier";
import { expandSectorMentionsWithLinks } from "@/lib/sector-links";
import { inferSectorsFromStockMention } from "@/lib/stock-sector-mapping";

/**
 * POST /api/cron/reanalyze-posts
 *
 * Re-runs sector identification on EXISTING posts (no Twitter fetch).
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
        include: { stock: { select: { id: true, ticker: true, market: true, assetType: true } } },
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

    const [directSectorMatches] = await Promise.all([
      identifySectorsAcrossMarkets(post.content),
    ]);

    const sectorMentionsById = new Map<string, SectorMention>();
    for (const sector of directSectorMatches) {
      sectorMentionsById.set(sector.sectorId, sector);
    }

    // Infer sectors from stock mentions
    for (const ps of post.postStocks) {
      const inferred = await inferSectorsFromStockMention(
        ps.stockId,
        ps.stock.ticker,
        ps.stock.market,
        ps.stock.assetType as "STOCK" | "ETF"
      );
      for (const sector of inferred) {
        if (!sectorMentionsById.has(sector.sectorId)) {
          sectorMentionsById.set(sector.sectorId, sector);
        }
      }
    }

    // Cross-market expansion (weak links)
    const expanded = await expandSectorMentionsWithLinks(
      sectorMentionsById.values()
    );

    for (const sector of expanded) {
      const sentiment = await detectSentiment(post.content, sector.name);
      await prisma.postSector.create({
        data: {
          postId: post.id,
          sectorId: sector.sectorId,
          confidence: sector.confidence,
          evidence: sector.evidence,
          sentiment,
        },
      });
      sectorMentions++;
    }

    if (expanded.length > 0) postsWithSectors++;
  }

  return NextResponse.json({
    posts: posts.length,
    postsWithSectors,
    sectorMentions,
  });
}
