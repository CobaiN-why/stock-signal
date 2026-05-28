import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyCronAuth } from "@/lib/cron-auth";
import { fetchUserTweets } from "@/lib/twitter";
import { identifyStocks, ensureStockExists } from "@/lib/stock-identifier";
import { sendMention, sendSentimentFlip, sendDivergence } from "@/lib/telegram";
import { detectSentiment } from "@/lib/sentiment";

export async function POST(req: NextRequest) {
  const authError = verifyCronAuth(req);
  if (authError) return authError;

  const bloggers = await prisma.blogger.findMany({
    where: { isActive: true },
  });

  let totalNew = 0;

  for (const blogger of bloggers) {
    try {
      const tweets = await fetchUserTweets(
        blogger.xUsername,
        blogger.lastFetchedAt ?? undefined
      );

      for (const tweet of tweets) {
        const exists = await prisma.post.findUnique({
          where: { xPostId: tweet.id },
        });
        if (exists) continue;

        const mentions = await identifyStocks(tweet.text);
        if (mentions.length === 0) continue;

        const post = await prisma.post.create({
          data: {
            bloggerId: blogger.id,
            xPostId: tweet.id,
            content: tweet.text,
            postedAt: new Date(tweet.createdAt),
            url: tweet.url,
          },
        });

        for (const mention of mentions) {
          const { id: stockId, isNew } = await ensureStockExists(mention.ticker);

          const sentiment = await detectSentiment(tweet.text, mention.ticker);

          await prisma.postStock.create({
            data: {
              postId: post.id,
              stockId,
              mentionType: mention.type,
              sentiment,
            },
          });

          // Only push Telegram for newly discovered stocks
          if (isNew) {
            await sendMention({
              ticker: mention.ticker,
              price: null,
              blogger: blogger.xUsername,
              postedAt: new Date(tweet.createdAt).toISOString().slice(0, 16).replace("T", " "),
              content: tweet.text,
              postUrl: tweet.url,
            });
          }

          // Sentiment change detection
          if (sentiment) {
            // Flip check: same blogger, same stock, previous sentiment differs
            const previousPost = await prisma.postStock.findFirst({
              where: {
                stockId,
                sentiment: { not: null },
                post: { bloggerId: blogger.id },
                id: { not: post.id },
              },
              orderBy: { post: { postedAt: "desc" } },
              select: { sentiment: true },
            });

            if (previousPost?.sentiment && previousPost.sentiment !== sentiment) {
              await sendSentimentFlip({
                ticker: mention.ticker,
                blogger: blogger.xUsername,
                previousSentiment: previousPost.sentiment,
                currentSentiment: sentiment,
                content: tweet.text,
                postUrl: tweet.url,
              });
            }

            // Divergence check: do bloggers now disagree?
            const latestByBlogger = await prisma.$queryRaw<
              { sentiment: string }[]
            >`
              SELECT DISTINCT ON (p.blogger_id) ps.sentiment
              FROM post_stocks ps
              JOIN posts p ON p.id = ps.post_id
              WHERE ps.stock_id = ${stockId}
                AND ps.sentiment IS NOT NULL
              ORDER BY p.blogger_id, p.posted_at DESC
            `;

            const sentiments = new Set(latestByBlogger.map((r) => r.sentiment));
            if (sentiments.has("bullish") && sentiments.has("bearish")) {
              // Check if this is newly divergent (without current post, was it homogeneous?)
              const previousByBlogger = await prisma.$queryRaw<
                { sentiment: string }[]
              >`
                SELECT DISTINCT ON (p.blogger_id) ps.sentiment
                FROM post_stocks ps
                JOIN posts p ON p.id = ps.post_id
                WHERE ps.stock_id = ${stockId}
                  AND ps.sentiment IS NOT NULL
                  AND ps.id != (
                    SELECT id FROM post_stocks
                    WHERE post_id = ${post.id} AND stock_id = ${stockId}
                    LIMIT 1
                  )
                ORDER BY p.blogger_id, p.posted_at DESC
              `;

              const prevSentiments = new Set(previousByBlogger.map((r) => r.sentiment));
              const wasHomogeneous = prevSentiments.size <= 1;

              if (wasHomogeneous) {
                const bullishBloggers: string[] = [];
                const bearishBloggers: string[] = [];

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

                for (const r of detailedLatest) {
                  if (r.sentiment === "bullish") bullishBloggers.push(r.x_username);
                  else bearishBloggers.push(r.x_username);
                }

                await sendDivergence({
                  ticker: mention.ticker,
                  bullishBloggers,
                  bearishBloggers,
                  content: tweet.text,
                  postUrl: tweet.url,
                });
              }
            }
          }
        }

        totalNew++;
      }

      await prisma.blogger.update({
        where: { id: blogger.id },
        data: { lastFetchedAt: new Date() },
      });
    } catch (err) {
      console.error(`Error fetching tweets for @${blogger.xUsername}:`, err);
    }
  }

  return NextResponse.json({ processed: bloggers.length, newPosts: totalNew });
}
