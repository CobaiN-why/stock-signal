import { prisma } from "../src/lib/db.js";
import { Prisma } from "../src/generated/prisma/client.js";
import {
  identifySectorsAcrossMarkets,
  type SectorMention,
} from "../src/lib/sector-identifier.js";
import {
  ensureStockExists,
  identifyStocksAcrossMarkets,
  type StockMention,
} from "../src/lib/stock-identifier.js";
import { expandSectorMentionsWithLinks } from "../src/lib/sector-links.js";
import { inferSectorsFromStockMention } from "../src/lib/stock-sector-mapping.js";
import {
  detectSentiment,
  detectSentimentByRules,
} from "../src/lib/sentiment.js";

interface Options {
  dryRun: boolean;
  prune: boolean;
  rulesOnly: boolean;
  limit?: number;
  username?: string;
  postId?: string;
  since?: Date;
}

interface ReprocessStats {
  scanned: number;
  changedPosts: number;
  stockMentions: number;
  sectorMentions: number;
  directSectorMentions: number;
  inferredSectorMentions: number;
  errors: number;
}

type Sentiment = "bullish" | "bearish" | null;

function parseArgs(argv: string[]): Options {
  const options: Options = {
    dryRun: false,
    prune: false,
    rulesOnly: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--prune") options.prune = true;
    else if (arg === "--rules-only") options.rulesOnly = true;
    else if (arg === "--limit" && next) {
      options.limit = Number(next);
      i++;
    } else if (arg === "--username" && next) {
      options.username = next.replace(/^@/, "");
      i++;
    } else if (arg === "--post-id" && next) {
      options.postId = next;
      i++;
    } else if (arg === "--since" && next) {
      options.since = new Date(next);
      i++;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown or incomplete argument: ${arg}`);
    }
  }

  if (options.limit !== undefined && (!Number.isFinite(options.limit) || options.limit <= 0)) {
    throw new Error("--limit must be a positive number");
  }
  if (options.since && Number.isNaN(options.since.getTime())) {
    throw new Error("--since must be a valid date, e.g. 2026-06-01");
  }

  return options;
}

function printHelp() {
  console.log(`Usage:
  npm run reprocess:posts -- [options]

Options:
  --dry-run          Print planned changes without writing to the database
  --prune            Remove old post-stock/post-sector links no longer detected
  --rules-only       Use keyword sentiment rules only; skip AI fallback
  --limit <n>        Reprocess at most n posts
  --username <name>  Reprocess one blogger by X username or display name
  --post-id <id>     Reprocess one local post id
  --since <date>     Reprocess posts posted on/after YYYY-MM-DD
`);
}

async function detectPostSentiment(
  text: string,
  target: string,
  rulesOnly: boolean
): Promise<Sentiment> {
  if (rulesOnly) return detectSentimentByRules(text);
  return detectSentiment(text, target);
}

async function resolveStockId(
  mention: StockMention,
  dryRun: boolean
): Promise<string | null> {
  if (!dryRun) {
    const { id } = await ensureStockExists(
      mention.ticker,
      mention.market,
      mention.assetType
    );
    return id;
  }

  const stock = await prisma.stock.findUnique({
    where: {
      market_ticker: {
        market: mention.market,
        ticker: mention.ticker,
      },
    },
    select: { id: true },
  });
  return stock?.id ?? null;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const stats: ReprocessStats = {
    scanned: 0,
    changedPosts: 0,
    stockMentions: 0,
    sectorMentions: 0,
    directSectorMentions: 0,
    inferredSectorMentions: 0,
    errors: 0,
  };
  const affectedStockIds = new Set<string>();
  const affectedSectorIds = new Set<string>();

  const posts = await prisma.post.findMany({
    where: {
      ...(options.postId ? { id: options.postId } : {}),
      ...(options.since ? { postedAt: { gte: options.since } } : {}),
      ...(options.username
        ? {
            blogger: {
              OR: [
                { xUsername: { equals: options.username, mode: "insensitive" } },
                { displayName: { equals: options.username, mode: "insensitive" } },
              ],
            },
          }
        : {}),
    },
    include: {
      blogger: { select: { xUsername: true, displayName: true } },
    },
    orderBy: { postedAt: "asc" },
    take: options.limit,
  });

  console.log(
    `Reprocessing ${posts.length} posts` +
      `${options.dryRun ? " (dry run)" : ""}` +
      `${options.prune ? " with prune" : ""}` +
      `${options.rulesOnly ? " using rules-only sentiment" : ""}`
  );

  if (posts.length === 0) {
    const bloggers = await prisma.blogger.findMany({
      where: options.username
        ? {
            OR: [
              { xUsername: { contains: options.username, mode: "insensitive" } },
              { displayName: { contains: options.username, mode: "insensitive" } },
            ],
          }
        : {},
      orderBy: { createdAt: "asc" },
      take: 20,
      include: { _count: { select: { posts: true } } },
    });

    if (bloggers.length > 0) {
      console.log("\nNo posts matched. Blogger candidates in DB:");
      for (const blogger of bloggers) {
        console.log(
          `- @${blogger.xUsername} (${blogger.displayName}) posts=${blogger._count.posts}`
        );
      }
    } else {
      console.log("\nNo posts matched, and no blogger candidates were found.");
    }
  }

  for (const post of posts) {
    stats.scanned++;

    try {
      const [stockMatches, directSectors] = await Promise.all([
        identifyStocksAcrossMarkets(post.content),
        identifySectorsAcrossMarkets(post.content),
      ]);

      const expectedStockIds = new Set<string>();
      const sectorById = new Map<string, SectorMention>();

      for (const sector of directSectors) {
        sectorById.set(sector.sectorId, sector);
      }

      for (const mention of stockMatches) {
        const stockId = await resolveStockId(mention, options.dryRun);

        const sentiment = await detectPostSentiment(
          post.content,
          mention.ticker,
          options.rulesOnly || options.dryRun
        );

        if (stockId) {
          expectedStockIds.add(stockId);
          affectedStockIds.add(stockId);
        }

        if (!options.dryRun && stockId) {
          await prisma.postStock.upsert({
            where: { postId_stockId: { postId: post.id, stockId } },
            update: {
              mentionType: mention.type,
              sentiment,
            },
            create: {
              postId: post.id,
              stockId,
              mentionType: mention.type,
              sentiment,
            },
          });
        }

        if (stockId) {
          const inferredSectors = await inferSectorsFromStockMention(
            stockId,
            mention.ticker,
            mention.market,
            mention.assetType
          );
          for (const inferredSector of inferredSectors) {
            if (!sectorById.has(inferredSector.sectorId)) {
              sectorById.set(inferredSector.sectorId, inferredSector);
            }
          }
        }

        stats.stockMentions++;
      }

      if (!options.dryRun && options.prune) {
        await prisma.postStock.deleteMany({
          where: {
            postId: post.id,
            ...(expectedStockIds.size > 0
              ? { stockId: { notIn: Array.from(expectedStockIds) } }
              : {}),
          },
        });
      }

      const expectedSectorIds = new Set<string>();
      const expandedSectorMentions = await expandSectorMentionsWithLinks(
        sectorById.values()
      );

      for (const sector of expandedSectorMentions) {
        expectedSectorIds.add(sector.sectorId);
        affectedSectorIds.add(sector.sectorId);

        const sentiment = await detectPostSentiment(
          post.content,
          sector.name,
          options.rulesOnly || options.dryRun
        );

        if (!options.dryRun) {
          await prisma.postSector.upsert({
            where: { postId_sectorId: { postId: post.id, sectorId: sector.sectorId } },
            update: {
              confidence: sector.confidence,
              evidence: sector.evidence,
              sentiment,
            },
            create: {
              postId: post.id,
              sectorId: sector.sectorId,
              confidence: sector.confidence,
              evidence: sector.evidence,
              sentiment,
            },
          });
        }

        stats.sectorMentions++;
        if (sector.confidence >= 0.7) stats.directSectorMentions++;
        else stats.inferredSectorMentions++;
      }

      if (!options.dryRun && options.prune) {
        await prisma.postSector.deleteMany({
          where: {
            postId: post.id,
            ...(expectedSectorIds.size > 0
              ? { sectorId: { notIn: Array.from(expectedSectorIds) } }
              : {}),
          },
        });
      }

      if (stockMatches.length > 0 || sectorById.size > 0) {
        stats.changedPosts++;
      }

      console.log(
        `✓ ${post.postedAt.toISOString().slice(0, 10)} @${post.blogger.xUsername}` +
          ` stocks=${stockMatches.length} sectors=${expandedSectorMentions.length}`
      );
    } catch (err) {
      stats.errors++;
      console.log(
        `✗ ${post.postedAt.toISOString().slice(0, 10)} @${post.blogger.xUsername}` +
          ` ${(err as Error).message.slice(0, 120)}`
      );
    }
  }

  if (!options.dryRun && (affectedStockIds.size > 0 || affectedSectorIds.size > 0)) {
    await prisma.stock.updateMany({
      where: {
        OR: [
          ...(affectedStockIds.size > 0
            ? [{ id: { in: Array.from(affectedStockIds) } }]
            : []),
          ...(affectedSectorIds.size > 0
            ? [{ sectorId: { in: Array.from(affectedSectorIds) } }]
            : []),
        ],
      },
      data: { cachedResponse: Prisma.JsonNull },
    });
  }

  console.log("\nDone.");
  console.table(stats);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
