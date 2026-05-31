// Audit all PostStock records: show stored sentiment, what rules would give, and raw text
// Usage: node --env-file=.env --import tsx scripts/audit-sentiment.ts

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { detectSentimentByRules } from "../src/lib/sentiment";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

async function main() {
  const records = await prisma.postStock.findMany({
    include: {
      post: { select: { content: true, postedAt: true, url: true } },
      stock: { select: { ticker: true } },
    },
    orderBy: { post: { postedAt: "desc" } },
  });

  console.log(`Total PostStock records: ${records.length}\n`);

  // Stats
  let storedBull = 0, storedBear = 0, storedNull = 0;
  let rulesMatch = 0, rulesMismatch = 0, rulesNull = 0;

  // Cases where rules return null (went to AI or stayed null)
  const rulesNullCases: { ticker: string; stored: string | null; text: string; date: string }[] = [];
  // Cases where rules disagree with stored
  const mismatchCases: { ticker: string; stored: string | null; rules: string | null; text: string; date: string }[] = [];

  for (const r of records) {
    const stored = r.sentiment;
    const rulesResult = detectSentimentByRules(r.post.content);
    const date = r.post.postedAt.toISOString().slice(0, 10);

    if (stored === "bullish") storedBull++;
    else if (stored === "bearish") storedBear++;
    else storedNull++;

    if (rulesResult === null) {
      rulesNull++;
      rulesNullCases.push({ ticker: r.stock.ticker, stored, text: r.post.content, date });
    } else if (rulesResult === stored) {
      rulesMatch++;
    } else {
      rulesMismatch++;
      mismatchCases.push({ ticker: r.stock.ticker, stored, rules: rulesResult, text: r.post.content, date });
    }
  }

  console.log("=== STORED SENTIMENT DISTRIBUTION ===");
  console.log(`bullish: ${storedBull}  bearish: ${storedBear}  null: ${storedNull}`);
  console.log();

  console.log("=== RULES COVERAGE ===");
  console.log(`rules matches stored: ${rulesMatch}`);
  console.log(`rules disagrees with stored: ${rulesMismatch}`);
  console.log(`rules returns null (AI fallback or null stored): ${rulesNull}`);
  console.log();

  if (mismatchCases.length > 0) {
    console.log("=== RULES vs STORED MISMATCHES ===");
    for (const c of mismatchCases) {
      console.log(`[${c.date}] $${c.ticker}  stored=${c.stored}  rules=${c.rules}`);
      console.log(`  "${c.text.slice(0, 200)}"`);
      console.log();
    }
  }

  // Deduplicate rules-null cases by unique post content
  const seen = new Set<string>();
  const uniqueNullCases: typeof rulesNullCases = [];
  for (const c of rulesNullCases) {
    const key = c.text.slice(0, 100);
    if (!seen.has(key)) {
      seen.add(key);
      uniqueNullCases.push(c);
    }
  }

  console.log(`=== RULES-NULL CASES (${uniqueNullCases.length} unique posts) ===`);
  // Separate into: stored=null (AI also failed), stored=bullish (AI caught it), stored=bearish
  const nullStoredNull = uniqueNullCases.filter(c => c.stored === null);
  const nullStoredBull = uniqueNullCases.filter(c => c.stored === "bullish");
  const nullStoredBear = uniqueNullCases.filter(c => c.stored === "bearish");

  console.log(`\n-- AI succeeded, stored=bullish (${nullStoredBull.length} unique posts) --`);
  for (const c of nullStoredBull) {
    console.log(`[${c.date}] (tickers in post include $${c.ticker})`);
    console.log(`  "${c.text.slice(0, 300)}"`);
    console.log();
  }

  console.log(`\n-- AI succeeded, stored=bearish (${nullStoredBear.length} unique posts) --`);
  for (const c of nullStoredBear) {
    console.log(`[${c.date}] (tickers in post include $${c.ticker})`);
    console.log(`  "${c.text.slice(0, 300)}"`);
    console.log();
  }

  console.log(`\n-- Both rules and AI returned null (${nullStoredNull.length} unique posts) --`);
  for (const c of nullStoredNull) {
    console.log(`[${c.date}] $${c.ticker}`);
    console.log(`  "${c.text.slice(0, 300)}"`);
    console.log();
  }
}

main().finally(() => prisma.$disconnect());
