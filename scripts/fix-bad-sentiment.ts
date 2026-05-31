// Fix known mis-classified PostStock sentiment records.
// Usage: node --env-file=.env --import tsx scripts/fix-bad-sentiment.ts
//
// Fixes three batches:
//  A) 2026-05-23 "YTD 3840%" post — 22 stocks stored bearish due to "short timeframe" bug → bullish
//  B) 2026-05-28 $SOI quote-critics post — stored bearish due to AI mis-reading quoted text → bullish
//  C) 2026-05-28 $SIVE/RPI meme-stock-defense post — same reason → bullish

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

async function fixByPostContent(
  label: string,
  contentSnippet: string,
  fromSentiment: string,
  toSentiment: string
) {
  const post = await prisma.post.findFirst({
    where: { content: { contains: contentSnippet } },
    select: { id: true, content: true, postedAt: true },
  });

  if (!post) {
    console.log(`[${label}] No post found for snippet: "${contentSnippet.slice(0, 60)}"`);
    return;
  }

  const { count } = await prisma.postStock.updateMany({
    where: { postId: post.id, sentiment: fromSentiment },
    data: { sentiment: toSentiment },
  });

  console.log(
    `[${label}] ${post.postedAt.toISOString().slice(0, 10)} — updated ${count} records ${fromSentiment} → ${toSentiment}`
  );
}

async function main() {
  // A) "YTD 3840%" post — all tickers stored bearish (short-timeframe bug), should be bullish
  await fixByPostContent(
    "A: YTD-3840 post",
    "YTD: 3840",
    "bearish",
    "bullish"
  );

  // B) SOI quote-critics post — "overvalued stock" quoted from media, AI misread as author's view
  await fixByPostContent(
    "B: SOI media-quote post",
    "overvalued stock",
    "bearish",
    "bullish"
  );

  // C) RPI/SIVE meme-stock defense post
  await fixByPostContent(
    "C: RPI meme-stock defense",
    "mass stupidity",
    "bearish",
    "bullish"
  );

  console.log("\nDone.");
}

main().finally(() => prisma.$disconnect());
