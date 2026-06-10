/**
 * Xiaohongshu (小红书) daily crawl script.
 * Called by cron: 11:00, 14:30, 00:00 daily.
 *
 * Usage: node --import dotenv/config --import tsx scripts/xhs-crawl.ts
 */

import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { scrapeUserPosts, closeBrowser } from "../src/lib/xiaohongshu/scraper.js";

const prisma = new PrismaClient({
  datasourceUrl: process.env.DATABASE_URL,
});

async function main() {
  console.log(`[XHS] Crawl started at ${new Date().toISOString()}`);

  const bloggers = await prisma.xhsBlogger.findMany({
    where: { isActive: true },
  });

  if (bloggers.length === 0) {
    console.log("[XHS] No active bloggers configured.");
    return;
  }

  console.log(`[XHS] Found ${bloggers.length} active bloggers`);

  let totalNewPosts = 0;

  for (const blogger of bloggers) {
    console.log(`[XHS] Processing @${blogger.nickname} (${blogger.xhsId})`);

    try {
      const posts = await scrapeUserPosts(
        blogger.xhsId,
        blogger.lastFetchedAt ?? undefined
          ? new Date(blogger.lastFetchedAt)
          : null
      );

      console.log(`[XHS] Got ${posts.length} new posts for @${blogger.nickname}`);

      // Save to DB
      for (const post of posts) {
        const exists = await prisma.xhsPost.findUnique({
          where: { xhsPostId: post.postId },
        });
        if (exists) continue;

        await prisma.xhsPost.create({
          data: {
            bloggerId: blogger.id,
            xhsPostId: post.postId,
            title: post.title,
            content: post.content,
            postedAt: new Date(post.postedAt),
            url: post.url,
            likeCount: post.likeCount,
            collectCount: post.collectCount,
            commentCount: post.commentCount,
            authorComments: {
              create: post.authorComments.map((c) => ({
                content: c.content,
                postedAt: new Date(c.postedAt),
              })),
            },
          },
        });

        totalNewPosts++;
      }

      // Update last fetched timestamp
      await prisma.xhsBlogger.update({
        where: { id: blogger.id },
        data: { lastFetchedAt: new Date() },
      });
    } catch (err) {
      console.error(
        `[XHS] Error scraping @${blogger.nickname}:`,
        String(err).slice(0, 200)
      );
    }
  }

  await closeBrowser();
  console.log(
    `[XHS] Crawl complete. ${totalNewPosts} new posts from ${bloggers.length} bloggers.`
  );
}

main()
  .catch((err) => {
    console.error("[XHS] Crawl failed:", err);
    closeBrowser();
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
