import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyCronAuth } from "@/lib/cron-auth";
import { detectSentiment } from "@/lib/sentiment";
import { analyzeSectorsAndSentiment } from "@/lib/sector-ai";
import type { SectorMention } from "@/lib/sector-identifier";
import {
  ensureStockExists,
  identifyStocksAcrossMarkets,
} from "@/lib/stock-identifier";
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
        // Fetch tweets from past month with cursor pagination (up to 30 pages = ~600 tweets)
        const oneMonthAgo = new Date(Date.now() - 30 * 86400000);
        const posts = await postSource.fetchUserPosts(blogger.xUsername, oneMonthAgo, 30);

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

          const stockMatches = await identifyStocksAcrossMarkets(sourcePost.text);
          if (stockMatches.length === 0) continue;

          // AI unified analysis
          const aiResults = await analyzeSectorsAndSentiment(sourcePost.text, stockMatches);

          const post = await prisma.post.create({
            data: {
              bloggerId: blogger.id,
              xPostId: sourcePost.id,
              content: sourcePost.text,
              postedAt: new Date(sourcePost.createdAt),
              url: sourcePost.url,
            },
          });

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

          const sectorMentionsById = new Map<string, SectorMention>();

          for (const mention of stockMatches) {
            const stockKey = `${mention.market}:${mention.ticker}`;
            const aiResult = aiByStock.get(stockKey);
            const sentiment = aiResult?.stockSentiment
              ?? await detectSentiment(sourcePost.text, mention.ticker);

            const { id: stockId } = await ensureStockExists(
              mention.ticker,
              mention.market,
              mention.assetType
            );
            await prisma.postStock.create({
              data: { postId: post.id, stockId, mentionType: mention.type, sentiment },
            });

            // AI sector mapping
            if (aiResult) {
              const sector = await prisma.sector.findUnique({
                where: { market_slug: { market: "CN", slug: aiResult.sectorSlug } },
                select: { id: true, name: true },
              });
              if (sector && !sectorMentionsById.has(sector.id)) {
                sectorMentionsById.set(sector.id, {
                  sectorId: sector.id,
                  market: "CN",
                  slug: aiResult.sectorSlug,
                  name: aiResult.sectorName,
                  evidence: aiResult.evidence,
                  confidence: aiResult.confidence,
                  sentiment: aiResult.sectorSentiment,
                  sentimentTarget: mention.ticker,
                } as SectorMention);
              }
            } else {
              // DB fallback
              const dbSectors = await inferSectorsFromStockMention(
                stockId, mention.ticker, mention.market, mention.assetType
              );
              for (const s of dbSectors) {
                if (!sectorMentionsById.has(s.sectorId)) {
                  sectorMentionsById.set(s.sectorId, s);
                }
              }
            }
            grandStock++;
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
                slug,
                name: aiResult.sectorName,
                evidence: aiResult.evidence,
                confidence: aiResult.confidence,
                sentiment: aiResult.sectorSentiment,
              } as SectorMention);
            }
          }

          // Write PostSectors
          for (const [_, sector] of sectorMentionsById) {
            const sentiment =
              sector.sentiment ??
              await detectSentiment(
                sourcePost.text,
                sector.sentimentTarget ?? sector.name
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
