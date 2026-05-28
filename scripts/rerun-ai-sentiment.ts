import { prisma } from "../src/lib/db.js";
import { detectSentimentByRules, detectSentiment } from "../src/lib/sentiment.js";

async function main() {
  // Find all PostStock records where rules cannot decide (AI-decided)
  const records = await prisma.postStock.findMany({
    where: { sentiment: { not: null } },
    include: {
      post: { select: { content: true } },
      stock: { select: { ticker: true } },
    },
  });

  const aiDecided = records.filter(
    (r) => !detectSentimentByRules(r.post.content)
  );

  console.log(
    `Found ${aiDecided.length} AI-decided records (out of ${records.length} total). Re-running with improved prompt...\n`
  );

  let changed = 0;
  let same = 0;
  let errors = 0;

  for (const r of aiDecided) {
    try {
      const newSentiment = await detectSentiment(r.post.content, r.stock.ticker);
      if (newSentiment !== r.sentiment) {
        await prisma.postStock.update({
          where: { id: r.id },
          data: { sentiment: newSentiment },
        });
        console.log(
          `✓ ${r.stock.ticker}: ${r.sentiment} → ${newSentiment ?? "null"} | ${r.post.content.slice(0, 60)}...`
        );
        changed++;
      } else {
        same++;
      }
    } catch (e) {
      errors++;
      console.log(
        `✗ ${r.stock.ticker}: error — ${(e as Error).message.slice(0, 80)}`
      );
    }
  }

  console.log(
    `\nDone. changed: ${changed}, same: ${same}, errors: ${errors}`
  );
  await prisma.$disconnect();
}

main();
