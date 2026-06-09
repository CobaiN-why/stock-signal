import { execFile } from "node:child_process";
import crypto from "node:crypto";
import path from "node:path";
import { promisify } from "node:util";
import { prisma } from "../src/lib/db.js";

const execFileAsync = promisify(execFile);

interface EastmoneySector {
  category: "industry" | "concept";
  name: string;
  code?: string;
}

interface Options {
  dryRun: boolean;
}

function parseArgs(argv: string[]): Options {
  const options: Options = { dryRun: false };
  for (const arg of argv) {
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--help" || arg === "-h") {
      console.log(`Usage:
  npm run sync:cn-sectors -- [--dry-run]

Sync Eastmoney industry/concept board names into CN sector keywords.`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function pythonCommand(): string {
  return process.env.CN_MARKET_DATA_PYTHON || "python3";
}

function providerScriptPath(): string {
  return path.join(process.cwd(), "scripts", "cn-akshare-provider.py");
}

function slugFor(category: string, name: string): string {
  const hash = crypto
    .createHash("sha1")
    .update(`${category}:${name}`)
    .digest("hex")
    .slice(0, 10);
  return `em-${category}-${hash}`;
}

function keywordsFor(name: string): string[] {
  const normalized = name.trim().toLowerCase();
  const stripped = normalized.replace(/(概念|板块|行业|指数)$/u, "").trim();
  return Array.from(new Set([normalized, stripped].filter(Boolean)));
}

async function fetchEastmoneySectors(): Promise<EastmoneySector[]> {
  const { stdout, stderr } = await execFileAsync(
    pythonCommand(),
    [providerScriptPath(), "sectors"],
    {
      timeout: 120_000,
      maxBuffer: 1024 * 1024 * 10,
    }
  );

  if (stderr.trim()) {
    console.warn(stderr.trim());
  }

  const rows = JSON.parse(stdout) as EastmoneySector[];
  return rows.filter((row) => row.name?.trim());
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const rows = await fetchEastmoneySectors();
  const deduped = new Map<string, EastmoneySector>();

  for (const row of rows) {
    const key = `${row.category}:${row.name}`;
    if (!deduped.has(key)) deduped.set(key, row);
  }

  let created = 0;
  let reused = 0;
  let keywords = 0;

  console.log(
    `Syncing ${deduped.size} Eastmoney CN sectors` +
      `${options.dryRun ? " (dry run)" : ""}`
  );

  for (const row of deduped.values()) {
    const name = row.name.trim();
    const existing = await prisma.sector.findFirst({
      where: { market: "CN", name },
      select: { id: true, slug: true },
    });
    const description = `东方财富${row.category === "industry" ? "行业" : "概念"}板块${row.code ? ` (${row.code})` : ""}`;

    if (options.dryRun) {
      if (existing) reused++;
      else created++;
      keywords += keywordsFor(name).length;
      continue;
    }

    const sector = existing
      ? await prisma.sector.update({
          where: { id: existing.id },
          data: { description },
        })
      : await prisma.sector.create({
          data: {
            market: "CN",
            slug: slugFor(row.category, name),
            name,
            description,
          },
        });

    if (existing) reused++;
    else created++;

    for (const keyword of keywordsFor(name)) {
      await prisma.sectorKeyword.upsert({
        where: {
          sectorId_keyword: {
            sectorId: sector.id,
            keyword,
          },
        },
        update: {},
        create: {
          sectorId: sector.id,
          keyword,
        },
      });
      keywords++;
    }
  }

  console.log("\nDone.");
  console.table({
    fetched: rows.length,
    deduped: deduped.size,
    created,
    reused,
    keywords,
  });
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
