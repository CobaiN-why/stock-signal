/**
 * Import scraped XHS posts from /tmp/xhs-posts.json into database.
 */
import { readFileSync } from "fs";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  let data: any[];
  try { data = JSON.parse(readFileSync("/tmp/xhs-posts.json", "utf8")); }
  catch { console.log("[XHS-Import] No file"); return; }

  let imported = 0;
  for (const post of data) {
    const blogger = await prisma.xhsBlogger.upsert({
      where: { xhsId: post.xhsId },
      update: { nickname: post.nickname },
      create: { xhsId: post.xhsId, nickname: post.nickname },
    });

    const exists = await prisma.xhsPost.findUnique({ where: { xhsPostId: post.postId } });
    if (exists) continue;

    await prisma.xhsPost.create({
      data: {
        bloggerId: blogger.id,
        xhsPostId: post.postId,
        title: post.title,
        content: "", // detail blocked, only title available
        postedAt: new Date(post.postedAt),
        url: post.url,
        likeCount: post.likeCount || 0,
        collectCount: post.collectCount || 0,
        commentCount: post.commentCount || 0,
      },
    });
    imported++;
  }
  console.log(`[XHS-Import] Imported ${imported} new posts`);
  await prisma.$disconnect();
}

main().catch((err) => { console.error("[XHS-Import]", err); process.exit(1); });
