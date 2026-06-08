import { prisma } from "@/lib/db";
import { detectSentiment } from "@/lib/sentiment";
import { identifySectorsAcrossMarkets } from "@/lib/sector-identifier";
import {
  ensureStockExists,
  identifyStocksAcrossMarkets,
  type StockMention,
} from "@/lib/stock-identifier";
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

        const [stockMatches, sectorMatches] = await Promise.all([
          identifyStocksAcrossMarkets(sourcePost.text),
          identifySectorsAcrossMarkets(sourcePost.text),
        ]);

        if (stockMatches.length === 0 && sectorMatches.length === 0) continue;

        const post = await prisma.post.create({
          data: {
            bloggerId: blogger.id,
            xPostId: sourcePost.id,
            content: sourcePost.text,
            postedAt: new Date(sourcePost.createdAt),
            url: sourcePost.url,
          },
        });

        for (const sector of sectorMatches) {
          await prisma.postSector.create({
            data: {
              postId: post.id,
              sectorId: sector.sectorId,
              confidence: sector.confidence,
              evidence: sector.evidence,
            },
          });
          sectorMentions++;

          await recordSectorMention({
            sectorId: sector.sectorId,
            sectorName: sector.name,
            market: sector.market,
            blogger: blogger.xUsername,
            content: sourcePost.text,
            postUrl: sourcePost.url,
          });
        }

        for (const mention of stockMatches) {
          await persistStockMention({
            mention,
            postId: post.id,
            bloggerId: blogger.id,
            bloggerUsername: blogger.xUsername,
            content: sourcePost.text,
            postUrl: sourcePost.url,
          });
          stockMentions++;
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
    const lines = errors.map((e) => `- @${e.username}: ${e.message.slice(0, 120)}`);
    await recordIngestAlert(
      [`fetch-posts 出错 (${errors.length}/${bloggers.length} 个博主失败)`, "", ...lines].join("\n")
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
}) {
  const { id: stockId, isNew } = await ensureStockExists(
    input.mention.ticker,
    input.mention.market,
    input.mention.assetType
  );

  const sentiment = await detectSentiment(input.content, input.mention.ticker);

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

  if (!sentiment) return;

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
  if (!sentiments.has("bullish") || !sentiments.has("bearish")) return;

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
  if (prevSentiments.size > 1) return;

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
}
