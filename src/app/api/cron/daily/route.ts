import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyCronAuth } from "@/lib/cron-auth";
import { fetchUserTweets } from "@/lib/twitter";
import { identifyStocks, ensureStockExists } from "@/lib/stock-identifier";
import { sendMention, sendSentimentFlip, sendDivergence } from "@/lib/telegram";
import { detectSentiment } from "@/lib/sentiment";
import { fetchDailyBars, fetchLatestPrice, fetchStockProfile } from "@/lib/yahoo";
import { generateStockAnalysis } from "@/lib/kimi";

const PROFILE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * GET/POST /api/cron/daily
 * Combined daily job: fetch-posts → sync-prices → update-latest
 * Supports GET for easy external cron service integration (e.g. cron-job.org)
 * Auth via ?secret= query param (GET) or Authorization header (POST)
 */
async function runDailyJob() {
  const results: Record<string, unknown> = {};

  // --- Step 1: Fetch posts ---
  try {
    const bloggers = await prisma.blogger.findMany({
      where: { isActive: true },
    });
    let newPosts = 0;

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
              data: { postId: post.id, stockId, mentionType: mention.type, sentiment },
            });

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

            if (sentiment) {
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
                if (prevSentiments.size <= 1) {
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
          newPosts++;
        }

        await prisma.blogger.update({
          where: { id: blogger.id },
          data: { lastFetchedAt: new Date() },
        });
      } catch (err) {
        console.error(`Error fetching tweets for @${blogger.xUsername}:`, err);
      }
    }
    results.fetchPosts = { bloggers: bloggers.length, newPosts };
  } catch (err) {
    console.error("fetch-posts step failed:", err);
    results.fetchPosts = { error: String(err) };
  }

  // --- Step 2: Sync prices ---
  try {
    const stocks = await prisma.stock.findMany({
      where: { postStocks: { some: {} } },
    });
    let synced = 0;

    for (const stock of stocks) {
      try {
        const lastBar = await prisma.priceHistory.findFirst({
          where: { stockId: stock.id },
          orderBy: { date: "desc" },
        });
        const from = lastBar
          ? new Date(lastBar.date.getTime() + 86400000)
          : new Date(Date.now() - 180 * 86400000);
        const to = new Date();
        if (from >= to) continue;

        const bars = await fetchDailyBars(stock.ticker, from, to);
        for (const bar of bars) {
          await prisma.priceHistory.upsert({
            where: { stockId_date: { stockId: stock.id, date: bar.date } },
            update: {
              open: bar.open,
              high: bar.high,
              low: bar.low,
              close: bar.close,
              volume: bar.volume,
            },
            create: {
              stockId: stock.id,
              date: bar.date,
              open: bar.open,
              high: bar.high,
              low: bar.low,
              close: bar.close,
              volume: bar.volume,
            },
          });
        }
        synced++;
      } catch (err) {
        console.error(`Error syncing prices for ${stock.ticker}:`, err);
      }
    }
    results.syncPrices = { synced, total: stocks.length };
  } catch (err) {
    console.error("sync-prices step failed:", err);
    results.syncPrices = { error: String(err) };
  }

  // --- Step 3: Update latest prices ---
  try {
    const stocks = await prisma.stock.findMany();
    let updated = 0;

    for (const stock of stocks) {
      try {
        const price = await fetchLatestPrice(stock.ticker);
        if (price !== null) {
          await prisma.stock.update({
            where: { id: stock.id },
            data: { latestPrice: price, priceUpdatedAt: new Date() },
          });
          updated++;
        }
      } catch (err) {
        console.error(`Error updating price for ${stock.ticker}:`, err);
      }
    }
    results.updateLatest = { updated, total: stocks.length };
  } catch (err) {
    console.error("update-latest step failed:", err);
    results.updateLatest = { error: String(err) };
  }

  // --- Step 4: Sync Yahoo profiles ---
  try {
    const stocks = await prisma.stock.findMany();
    let synced = 0;

    for (const stock of stocks) {
      const stale =
        !stock.profileData ||
        !stock.profileUpdatedAt ||
        Date.now() - stock.profileUpdatedAt.getTime() > PROFILE_TTL_MS;
      if (!stale) continue;

      try {
        const profile = await fetchStockProfile(stock.ticker);
        if (profile) {
          await prisma.stock.update({
            where: { id: stock.id },
            data: { profileData: profile as object, profileUpdatedAt: new Date() },
          });
          synced++;
        }
      } catch (err) {
        console.error(`Error syncing profile for ${stock.ticker}:`, err);
      }
    }
    results.syncProfiles = { synced, total: stocks.length };
  } catch (err) {
    console.error("sync-profiles step failed:", err);
    results.syncProfiles = { error: String(err) };
  }

  // --- Step 5: Generate Kimi analyses ---
  try {
    if (!process.env.KIMI_API_KEY) {
      results.generateAnalyses = { skipped: "no KIMI_API_KEY" };
    } else {
      const stocks = await prisma.stock.findMany({
        where: { analysis: null },
        select: { id: true, ticker: true, profileData: true },
      });
      let generated = 0;

      for (const stock of stocks) {
        if (!stock.profileData) continue;
        try {
          const content = await generateStockAnalysis(
            stock.ticker,
            stock.profileData as unknown as Parameters<typeof generateStockAnalysis>[1]
          );
          if (content) {
            await prisma.stockAnalysis.create({
              data: { stockId: stock.id, content },
            });
            generated++;
          }
        } catch (err) {
          console.error(`Error generating analysis for ${stock.ticker}:`, err);
        }
      }
      results.generateAnalyses = { generated, total: stocks.length };
    }
  } catch (err) {
    console.error("generate-analyses step failed:", err);
    results.generateAnalyses = { error: String(err) };
  }

  return results;
}

async function handler(req: NextRequest) {
  // Support auth via query param for GET requests (cron-job.org style)
  const secretParam = req.nextUrl.searchParams.get("secret");
  if (secretParam) {
    const expected = process.env.CRON_SECRET;
    if (!expected || secretParam !== expected) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  } else {
    const authError = verifyCronAuth(req);
    if (authError) return authError;
  }

  // Return immediately so cron-job.org doesn't timeout; job runs in background
  runDailyJob().catch((err) => console.error("daily job failed:", err));

  return NextResponse.json({ ok: true, status: "running" });
}

export const GET = handler;
export const POST = handler;
