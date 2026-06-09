import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyCronAuth } from "@/lib/cron-auth";
import { detectSentiment } from "@/lib/sentiment";
import {
  identifySectorsAcrossMarkets,
  type SectorMention,
} from "@/lib/sector-identifier";
import {
  ensureStockExists,
  identifyStocksAcrossMarkets,
} from "@/lib/stock-identifier";
import { expandSectorMentionsWithLinks } from "@/lib/sector-links";
import { inferSectorsFromStockMention } from "@/lib/stock-sector-mapping";
import { getPostSource } from "@/lib/social";

/**
 * POST /api/cron/backfill-posts
 * Fetches ALL available historical posts for active bloggers (not just new ones).
 * Uses TwitterAPI.io which returns recent tweets; calling without since_date
 * fetches the maximum available history.
 *
 * Query params:
 *   ?blogger=username — backfill a single blogger
 *   ?limit=50 — max posts to fetch per blogger (default 50)
 */
export async function POST(req: NextRequest) {
  const authError = verifyCronAuth(req);
  if (authError) return authError;

  const targetUsername = req.nextUrl.searchParams.get("blogger") ?? undefined;
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? "50");

  const postSource = getPostSource();
  const bloggers = targetUsername
    ? await prisma.blogger.findMany({
        where: { xUsername: targetUsername, isActive: true },
      })
    : await prisma.blogger.findMany({ where: { isActive: true } });

  let totalNew = 0;
  let totalStockMentions = 0;
  let totalSectorMentions = 0;
  const errors: string[] = [];

  for (const blogger of bloggers) {
    try {
      // Fetch without since_date to get all available history
      const posts = await postSource.fetchUserPosts(blogger.xUsername);

      let newForBlogger = 0;
      for (const sourcePost of posts) {
        if (newForBlogger >= limit) break;

        const exists = await prisma.post.findUnique({
          where: { xPostId: sourcePost.id },
        });
        if (exists) continue;

        const [stockMatches, directSectorMatches] = await Promise.all([
          identifyStocksAcrossMarkets(sourcePost.text),
          identifySectorsAcrossMarkets(sourcePost.text),
        ]);

        if (stockMatches.length === 0 && directSectorMatches.length === 0)
          continue;

        const post = await prisma.post.create({
          data: {
            bloggerId: blogger.id,
            xPostId: sourcePost.id,
            content: sourcePost.text,
            postedAt: new Date(sourcePost.createdAt),
            url: sourcePost.url,
          },
        });

        const sectorMentionsById = new Map<string, SectorMention>();
        for (const sector of directSectorMatches) {
          sectorMentionsById.set(sector.sectorId, sector);
        }

        for (const mention of stockMatches) {
          const { id: stockId, isNew } = await ensureStockExists(
            mention.ticker,
            mention.market,
            mention.assetType
          );

          const sentiment = await detectSentiment(
            sourcePost.text,
            mention.ticker
          );
          await prisma.postStock.create({
            data: {
              postId: post.id,
              stockId,
              mentionType: mention.type,
              sentiment,
            },
          });

          // Infer sectors from stock mention
          const inferredSectors = await inferSectorsFromStockMention(
            stockId,
            mention.ticker,
            mention.market,
            mention.assetType
          );
          for (const sector of inferredSectors) {
            if (!sectorMentionsById.has(sector.sectorId)) {
              sectorMentionsById.set(sector.sectorId, sector);
            }
          }
          totalStockMentions++;
        }

        const expandedSectorMentions = await expandSectorMentionsWithLinks(
          sectorMentionsById.values()
        );

        for (const sector of expandedSectorMentions) {
          const sentiment = await detectSentiment(
            sourcePost.text,
            sector.name
          );
          await prisma.postSector.create({
            data: {
              postId: post.id,
              sectorId: sector.sectorId,
              confidence: sector.confidence,
              evidence: sector.evidence,
              sentiment,
            },
          });
          totalSectorMentions++;
        }

        newForBlogger++;
        totalNew++;
      }

      // Reset lastFetchedAt so future fetches pick up where we left off
      if (newForBlogger > 0) {
        await prisma.blogger.update({
          where: { id: blogger.id },
          data: { lastFetchedAt: new Date() },
        });
      }
    } catch (err) {
      const message = String(err);
      errors.push(`@${blogger.xUsername}: ${message.slice(0, 100)}`);
    }
  }

  return NextResponse.json({
    bloggers: bloggers.length,
    newPosts: totalNew,
    stockMentions: totalStockMentions,
    sectorMentions: totalSectorMentions,
    errors,
  });
}
