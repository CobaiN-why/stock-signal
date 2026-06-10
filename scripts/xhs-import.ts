/**
 * Import scraped XHS posts from JSON into database.
 * Reads /tmp/xhs-posts.json, upserts into xhs_bloggers / xhs_posts / xhs_author_comments.
 */

import { readFileSync } from "fs";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

interface ImportPost {
  xhsId: string;
  nickname: string;
  postId: string;
  title: string;
  content: string;
  postedAt: string;
  url: string;
  likeCount: number;
  collectCount: number;
  commentCount: number;
  authorComments: { content: string; postedAt: string }[];
}

async function main() {
  let data: ImportPost[];
  try {
    data = JSON.parse(readFileSync("/tmp/xhs-posts.json", "utf8"));
  } catch {
    console.log("[XHS-Import] No import file found");
    return;
  }

  let imported = 0;
  let commentsImported = 0;

  for (const post of data) {
    // Ensure blogger exists
    const blogger = await prisma.xhsBlogger.upsert({
      where: { xhsId: post.xhsId },
      update: { nickname: post.nickname },
      create: {
        xhsId: post.xhsId,
        nickname: post.nickname,
      },
    });

    // Upsert post
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
    imported++;
    commentsImported += post.authorComments.length;
  }

  console.log(
    `[XHS-Import] Imported ${imported} posts, ${commentsImported} comments`
  );

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[XHS-Import] Error:", err);
  process.exit(1);
});
