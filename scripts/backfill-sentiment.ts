import { prisma } from "../src/lib/db.js";
import { detectSentiment } from "../src/lib/sentiment.js";

async function main() {
  // All PostStock records without sentiment, with their post content and ticker
  const records = await prisma.postStock.findMany({
    where: { sentiment: null },
    include: {
      post: { select: { content: true } },
      stock: { select: { ticker: true } },
    },
  });

  console.log(`Backfilling sentiment for ${records.length} post-stock records...\n`);

  let bullish = 0;
  let bearish = 0;
  let unknown = 0;

  for (const r of records) {
    try {
      const sentiment = await detectSentiment(r.post.content, r.stock.ticker);
      if (sentiment) {
        await prisma.postStock.update({
          where: { id: r.id },
          data: { sentiment },
        });
        if (sentiment === "bullish") bullish++;
        else bearish++;
        console.log(`✓ ${r.stock.ticker} → ${sentiment}`);
      } else {
        unknown++;
        console.log(`- ${r.stock.ticker} → unknown`);
      }
    } catch (e) {
      unknown++;
      console.log(`✗ ${r.stock.ticker} → error: ${(e as Error).message.slice(0, 80)}`);
    }
  }

  console.log(`\nDone. bullish: ${bullish}, bearish: ${bearish}, unknown: ${unknown}`);
  await prisma.$disconnect();
}

main();
