import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyCronAuth } from "@/lib/cron-auth";
import { fetchUserTweets } from "@/lib/twitter";
import { identifyStocks, ensureStockExists } from "@/lib/stock-identifier";
import { sendMention } from "@/lib/telegram";

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

          await prisma.postStock.create({
            data: {
              postId: post.id,
              stockId,
              mentionType: mention.type,
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
