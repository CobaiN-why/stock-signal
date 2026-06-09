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
 *
 * Continuously fetches historical posts until exhausted or limit reached.
 * Each blogger is processed in a loop: fetch batch → save new posts → repeat
 * until a batch returns 0 new posts (meaning we've caught up with history).
 *
 * Query params:
 *   ?blogger=username — backfill a single blogger
 *   ?maxPerBlogger=200 — max posts per blogger per run (default 200)
 */
export async function POST(req: NextRequest) {
  const authError = verifyCronAuth(req);
  if (authError) return authError;

  const targetUsername = req.nextUrl.searchParams.get("blogger") ?? undefined;
  const maxPerBlogger = Number(req.nextUrl.searchParams.get("maxPerBlogger") ?? "200");

  const postSource = getPostSource();
  const bloggers = targetUsername
    ? await prisma.blogger.findMany({
        where: { xUsername: targetUsername, isActive: true },
      })
    : await prisma.blogger.findMany({ where: { isActive: true } });

  let grandTotal = 0;
  let grandStock = 0;
  let grandSector = 0;
  const results: { username: string; fetched: number; exhausted: boolean; error?: string }[] = [];

  for (const blogger of bloggers) {
    let totalForBlogger = 0;
    let exhausted = false;
    let consecutiveEmpty = 0;
    const maxRounds = 10; // safety cap: max 10 API calls per blogger per run

    try {
      for (let round = 0; round < maxRounds; round++) {
        // Fetch without since_date to get max available history
        const posts = await postSource.fetchUserPosts(blogger.xUsername);

        // If no posts at all, this blogger is exhausted
        if (posts.length === 0) {
          exhausted = true;
          break;
        }

        let newInBatch = 0;
        for (const sourcePost of posts) {
          if (totalForBlogger >= maxPerBlogger) {
            exhausted = false;
            break;
          }

          const exists = await prisma.post.findUnique({
            where: { xPostId: sourcePost.id },
          });
          if (exists) continue;

          const [stockMatches, directSectorMatches] = await Promise.all([
            identifyStocksAcrossMarkets(sourcePost.text),
            identifySectorsAcrossMarkets(sourcePost.text),
          ]);

          if (stockMatches.length === 0 && directSectorMatches.length === 0) continue;

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
            const { id: stockId } = await ensureStockExists(
              mention.ticker,
              mention.market,
              mention.assetType
            );
            const sentiment = await detectSentiment(sourcePost.text, mention.ticker);
            await prisma.postStock.create({
              data: { postId: post.id, stockId, mentionType: mention.type, sentiment },
            });

            const inferredSectors = await inferSectorsFromStockMention(
              stockId, mention.ticker, mention.market, mention.assetType
            );
            for (const sector of inferredSectors) {
              if (!sectorMentionsById.has(sector.sectorId)) {
                sectorMentionsById.set(sector.sectorId, sector);
              }
            }
            grandStock++;
          }

          const expanded = await expandSectorMentionsWithLinks(sectorMentionsById.values());
          for (const sector of expanded) {
            const sentiment = await detectSentiment(sourcePost.text, sector.name);
            await prisma.postSector.create({
              data: {
                postId: post.id, sectorId: sector.sectorId,
                confidence: sector.confidence, evidence: sector.evidence, sentiment,
              },
            });
            grandSector++;
          }

          newInBatch++;
          totalForBlogger++;
          grandTotal++;
        }

        // If this batch had no new posts, we've exhausted available history
        if (newInBatch === 0) {
          consecutiveEmpty++;
          if (consecutiveEmpty >= 2) {
            exhausted = true;
            break;
          }
        } else {
          consecutiveEmpty = 0;
        }

        // Short delay between rounds
        await new Promise((r) => setTimeout(r, 1000));
      }
    } catch (err) {
      results.push({
        username: blogger.xUsername,
        fetched: totalForBlogger,
        exhausted: false,
        error: String(err).slice(0, 100),
      });
      continue;
    }

    // Update lastFetchedAt after backfill
    if (totalForBlogger > 0) {
      await prisma.blogger.update({
        where: { id: blogger.id },
        data: { lastFetchedAt: new Date() },
      });
    }

    results.push({ username: blogger.xUsername, fetched: totalForBlogger, exhausted });
  }

  const fullyExhausted = results.filter((r) => r.exhausted).length;

  return NextResponse.json({
    bloggers: bloggers.length,
    fullyExhausted,
    newPosts: grandTotal,
    stockMentions: grandStock,
    sectorMentions: grandSector,
    results,
  });
}
