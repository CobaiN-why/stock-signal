import { prisma } from "@/lib/db";
import { detectSentiment } from "@/lib/sentiment";
import {
  analyzeSectorsAndSentiment,
  type Sentiment,
  type UnifiedAnalysis,
} from "@/lib/sector-ai";
import {
  ensureStockExists,
  identifyStocksAcrossMarkets,
  type StockMention,
} from "@/lib/stock-identifier";
import { inferSectorsFromStockMention } from "@/lib/stock-sector-mapping";
import { getPostSource } from "@/lib/social";
import {
  recordDivergence,
  recordIngestAlert,
  recordNewStockMention,
  recordSectorMention,
  recordSentimentFlip,
} from "@/lib/signal-events";

interface IngestResult {
  bloggers: number;
  newPosts: number;
  stockMentions: number;
  sectorMentions: number;
  errors: { username: string; message: string }[];
}

interface SectorMentionInput {
  sectorId: string;
  market: string;
  slug: string;
  name: string;
  evidence: string;
  confidence: number;
  sentiment: Sentiment | null;
  sentimentTarget?: string;
}

export async function ingestPostsFromActiveBloggers(): Promise<IngestResult> {
  const bloggers = await prisma.blogger.findMany({
    where: { isActive: true },
  });

  const postSource = getPostSource();
  const errors: IngestResult["errors"] = [];
  let newPosts = 0;
  let stockMentions = 0;
  let sectorMentions = 0;

  for (const blogger of bloggers) {
    try {
      const posts = await postSource.fetchUserPosts(
        blogger.xUsername,
        blogger.lastFetchedAt ?? undefined
      );

      for (const sourcePost of posts) {
        const exists = await prisma.post.findUnique({
          where: { xPostId: sourcePost.id },
        });
        if (exists) continue;

        const stockMatches = await identifyStocksAcrossMarkets(sourcePost.text);
        if (stockMatches.length === 0) continue;

        // ── Step 1: AI unified analysis (sectors + sentiment, one call) ──
        const aiResults = await analyzeSectorsAndSentiment(
          sourcePost.text,
          stockMatches
        );

        // Build lookups from AI results
        const aiByStock = new Map<string, UnifiedAnalysis>();
        const aiDirectSectors = new Map<string, UnifiedAnalysis>();
        for (const r of aiResults) {
          if (r.ticker && r.market) {
            aiByStock.set(`${r.market}:${r.ticker}`, r);
          } else {
            // Direct sector mention (no ticker)
            const existing = aiDirectSectors.get(r.sectorSlug);
            if (!existing || existing.confidence < r.confidence) {
              aiDirectSectors.set(r.sectorSlug, r);
            }
          }
        }

        const post = await prisma.post.create({
          data: {
            bloggerId: blogger.id,
            xPostId: sourcePost.id,
            content: sourcePost.text,
            postedAt: new Date(sourcePost.createdAt),
            url: sourcePost.url,
          },
        });

        // ── Step 2: Persist stock mentions ──
        const sectorMentionsById = new Map<string, SectorMentionInput>();

        for (const mention of stockMatches) {
          const stockKey = `${mention.market}:${mention.ticker}`;
          const aiResult = aiByStock.get(stockKey);

          const result = await persistStockMention({
            mention,
            postId: post.id,
            bloggerId: blogger.id,
            bloggerUsername: blogger.xUsername,
            content: sourcePost.text,
            postUrl: sourcePost.url,
            aiSentiment: aiResult?.stockSentiment ?? undefined,
            skipSectorInference: !!aiResult,
          });
          stockMentions++;

          // Collect sector mentions: AI result takes priority
          if (aiResult) {
            const sector = await lookupCnSector(aiResult.sectorSlug);
            if (sector) {
              mergeSectorMention(sectorMentionsById, {
                sectorId: sector.id,
                market: "CN",
                slug: aiResult.sectorSlug,
                name: aiResult.sectorName,
                evidence: aiResult.evidence,
                confidence: aiResult.confidence,
                sentiment: aiResult.sectorSentiment,
                sentimentTarget: mention.ticker,
              });
            }
          } else {
            // DB fallback for stocks AI didn't map
            for (const s of result.dbSectors) {
              mergeSectorMention(sectorMentionsById, {
                sectorId: s.sectorId,
                market: s.market,
                slug: s.slug,
                name: s.name,
                evidence: s.evidence,
                confidence: s.confidence,
                sentiment: s.sentiment ?? null,
                sentimentTarget: s.sentimentTarget,
              });
            }
          }
        }

        // ── Step 3: Direct sector mentions from AI (no ticker attached) ──
        for (const [slug, aiResult] of aiDirectSectors) {
          const sector = await lookupCnSector(slug);
          if (sector) {
            mergeSectorMention(sectorMentionsById, {
              sectorId: sector.id,
              market: "CN",
              slug,
              name: aiResult.sectorName,
              evidence: aiResult.evidence,
              confidence: aiResult.confidence,
              sentiment: aiResult.sectorSentiment,
            });
          }
        }

        // ── Step 4: CN ETF DB supplement (sectors AI may have missed) ──
        for (const mention of stockMatches) {
          if (!(mention.assetType === "ETF" && mention.market === "CN")) continue;

          const { id: stockId } = await ensureStockExists(
            mention.ticker,
            mention.market,
            mention.assetType
          );
          const dbSectors = await inferSectorsFromStockMention(
            stockId,
            mention.ticker,
            mention.market,
            mention.assetType
          );

          for (const s of dbSectors) {
            if (sectorMentionsById.has(s.sectorId)) continue;

            const sentiment =
              s.sentiment ?? (await detectSentiment(sourcePost.text, s.name));

            mergeSectorMention(sectorMentionsById, {
              sectorId: s.sectorId,
              market: s.market,
              slug: s.slug,
              name: s.name,
              evidence: s.evidence,
              confidence: s.confidence,
              sentiment,
              sentimentTarget: s.sentimentTarget,
            });
          }
        }

        // ── Step 5: Write PostSector + SignalEvent ──
        for (const [, sector] of sectorMentionsById) {
          const sentiment = sector.sentiment ?? null;

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

          await recordSectorMention({
            sectorId: sector.sectorId,
            sectorName: sector.name,
            market: sector.market as "US" | "CN",
            blogger: blogger.xUsername,
            content: sourcePost.text,
            postUrl: sourcePost.url,
            confidence: sector.confidence,
            evidence: sector.evidence,
            sentiment,
          });
        }

        newPosts++;
      }

      await prisma.blogger.update({
        where: { id: blogger.id },
        data: { lastFetchedAt: new Date() },
      });
    } catch (err) {
      const message = String(err);
      console.error(`Error fetching posts for @${blogger.xUsername}:`, err);
      errors.push({ username: blogger.xUsername, message });
    }
  }

  if (errors.length > 0) {
    const lines = errors.map(
      (e) => `- @${e.username}: ${e.message.slice(0, 120)}`
    );
    await recordIngestAlert(
      [
        `fetch-posts 出错 (${errors.length}/${bloggers.length} 个博主失败)`,
        "",
        ...lines,
      ].join("\n")
    ).catch(() => {});
  }

  return {
    bloggers: bloggers.length,
    newPosts,
    stockMentions,
    sectorMentions,
    errors,
  };
}

async function persistStockMention(input: {
  mention: StockMention;
  postId: string;
  bloggerId: string;
  bloggerUsername: string;
  content: string;
  postUrl: string;
  aiSentiment?: Sentiment | null;
  skipSectorInference?: boolean;
}): Promise<{
  stockId: string;
  sentiment: string | null;
  dbSectors: Awaited<ReturnType<typeof inferSectorsFromStockMention>>;
}> {
  const { id: stockId, isNew } = await ensureStockExists(
    input.mention.ticker,
    input.mention.market,
    input.mention.assetType
  );

  // Use AI sentiment if available, otherwise fall back to rules+AI sentiment detection
  const sentiment = input.aiSentiment ?? (await detectSentiment(input.content, input.mention.ticker));

  const postStock = await prisma.postStock.create({
    data: {
      postId: input.postId,
      stockId,
      mentionType: input.mention.type,
      sentiment,
    },
  });

  if (isNew) {
    await recordNewStockMention({
      ticker: input.mention.ticker,
      market: input.mention.market,
      stockId,
      blogger: input.bloggerUsername,
      content: input.content,
      postUrl: input.postUrl,
    });
  }

  // DB sector inference (skip if AI already handled it)
  const dbSectors = input.skipSectorInference
    ? []
    : await inferSectorsFromStockMention(
        stockId,
        input.mention.ticker,
        input.mention.market,
        input.mention.assetType
      );

  if (!sentiment) return { stockId, sentiment, dbSectors };

  // ── Signal events: sentiment flip & divergence ──
  const previousPost = await prisma.postStock.findFirst({
    where: {
      stockId,
      sentiment: { not: null },
      post: { bloggerId: input.bloggerId },
      id: { not: postStock.id },
    },
    orderBy: { post: { postedAt: "desc" } },
    select: { sentiment: true },
  });

  if (previousPost?.sentiment && previousPost.sentiment !== sentiment) {
    await recordSentimentFlip({
      ticker: input.mention.ticker,
      market: input.mention.market,
      stockId,
      blogger: input.bloggerUsername,
      previousSentiment: previousPost.sentiment,
      currentSentiment: sentiment,
      content: input.content,
      postUrl: input.postUrl,
    });
  }

  const latestByBlogger = await prisma.$queryRaw<{ sentiment: string }[]>`
    SELECT DISTINCT ON (p.blogger_id) ps.sentiment
    FROM post_stocks ps
    JOIN posts p ON p.id = ps.post_id
    WHERE ps.stock_id = ${stockId}
      AND ps.sentiment IS NOT NULL
    ORDER BY p.blogger_id, p.posted_at DESC
  `;

  const sentiments = new Set(latestByBlogger.map((r) => r.sentiment));
  if (!sentiments.has("bullish") || !sentiments.has("bearish")) {
    return { stockId, sentiment, dbSectors };
  }

  const previousByBlogger = await prisma.$queryRaw<{ sentiment: string }[]>`
    SELECT DISTINCT ON (p.blogger_id) ps.sentiment
    FROM post_stocks ps
    JOIN posts p ON p.id = ps.post_id
    WHERE ps.stock_id = ${stockId}
      AND ps.sentiment IS NOT NULL
      AND ps.id != ${postStock.id}
    ORDER BY p.blogger_id, p.posted_at DESC
  `;

  const prevSentiments = new Set(previousByBlogger.map((r) => r.sentiment));
  if (prevSentiments.size > 1) {
    return { stockId, sentiment, dbSectors };
  }

  const detailedLatest = await prisma.$queryRaw<
    { sentiment: string; x_username: string }[]
  >`
    SELECT DISTINCT ON (p.blogger_id) ps.sentiment, b.x_username
    FROM post_stocks ps
    JOIN posts p ON p.id = ps.post_id
    JOIN bloggers b ON b.id = p.blogger_id
    WHERE ps.stock_id = ${stockId}
      AND ps.sentiment IS NOT NULL
    ORDER BY p.blogger_id, p.posted_at DESC
  `;

  const bullishBloggers: string[] = [];
  const bearishBloggers: string[] = [];
  for (const r of detailedLatest) {
    if (r.sentiment === "bullish") bullishBloggers.push(r.x_username);
    else bearishBloggers.push(r.x_username);
  }

  await recordDivergence({
    ticker: input.mention.ticker,
    market: input.mention.market,
    stockId,
    bullishBloggers,
    bearishBloggers,
    content: input.content,
    postUrl: input.postUrl,
  });

  return { stockId, sentiment, dbSectors };
}

// ── Helpers ──

async function lookupCnSector(slug: string) {
  const sector = await prisma.sector.findUnique({
    where: { market_slug: { market: "CN", slug } },
    select: { id: true, name: true },
  });
  return sector;
}

function mergeSectorMention(
  map: Map<string, SectorMentionInput>,
  mention: SectorMentionInput
) {
  const existing = map.get(mention.sectorId);
  if (!existing || existing.confidence < mention.confidence) {
    map.set(mention.sectorId, mention);
  }
}
