import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { Prisma } from "../src/generated/prisma/client.js";
import { prisma } from "../src/lib/db.js";

const execFileAsync = promisify(execFile);

interface CnEtf {
  ticker: string;
  name: string;
  latestPrice?: number | null;
  amount?: number | null;
  volume?: number | null;
  marketValue?: number | null;
  rankValue?: number | null;
}

interface Options {
  dryRun: boolean;
  maxPerSector: number;
}

const GENERIC_TERMS = new Set([
  "etf",
  "基金",
  "指数",
  "行业",
  "概念",
  "板块",
  "主题",
  "a股",
  "中国",
]);

const EXTRA_SYNONYMS: Record<string, string[]> = {
  半导体: ["芯片", "集成电路"],
  芯片: ["半导体", "集成电路"],
  新能源: ["新能源车", "光伏", "储能", "锂电", "电池"],
  光伏: ["新能源", "太阳能"],
  证券: ["券商"],
  金融: ["银行", "证券", "券商", "保险"],
  医药: ["医疗", "创新药", "生物医药"],
  消费: ["食品饮料", "酒", "白酒"],
  人工智能: ["ai", "算力", "机器人"],
  机器人: ["人工智能", "ai"],
  军工: ["国防", "国防军工"],
};

type SectorRow = Awaited<ReturnType<typeof loadCnSectors>>[number];

function parseArgs(argv: string[]): Options {
  const options: Options = { dryRun: false, maxPerSector: 5 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--max-per-sector" && next) {
      options.maxPerSector = Number(next);
      i++;
    } else if (arg === "--help" || arg === "-h") {
      console.log(`Usage:
  npm run sync:cn-sector-etfs -- [--max-per-sector 5] [--dry-run]

Map synced CN sectors to tradable ETFs using Eastmoney ETF names.`);
      process.exit(0);
    } else {
      throw new Error(`Unknown or incomplete argument: ${arg}`);
    }
  }
  if (!Number.isFinite(options.maxPerSector) || options.maxPerSector <= 0) {
    throw new Error("--max-per-sector must be a positive number");
  }
  return options;
}

function pythonCommand(): string {
  return process.env.CN_MARKET_DATA_PYTHON || "python3";
}

function providerScriptPath(): string {
  return path.join(process.cwd(), "scripts", "cn-akshare-provider.py");
}

async function fetchCnEtfs(): Promise<CnEtf[]> {
  const { stdout, stderr } = await execFileAsync(
    pythonCommand(),
    [providerScriptPath(), "etfs"],
    {
      timeout: 120_000,
      maxBuffer: 1024 * 1024 * 20,
    }
  );

  if (stderr.trim()) {
    console.warn(stderr.trim());
  }

  const rows = JSON.parse(stdout) as CnEtf[];
  return rows.filter((row) => row.ticker?.trim() && row.name?.trim());
}

async function loadCnSectors() {
  return prisma.sector.findMany({
    where: { market: "CN" },
    include: { keywords: true },
    orderBy: { name: "asc" },
  });
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[（）()【】\[\]\s_-]/g, "")
    .replace(/交易型开放式指数证券投资基金/g, "")
    .replace(/联接基金/g, "")
    .replace(/etf/g, "")
    .trim();
}

function stripGenericSuffix(value: string): string {
  return value
    .replace(/(概念|板块|行业|指数|主题)$/u, "")
    .replace(/(设备|服务|制造|应用|材料|电池|产业)$/u, "")
    .trim();
}

function sectorTerms(sector: SectorRow): string[] {
  const rawTerms = [
    sector.name,
    stripGenericSuffix(sector.name),
    ...sector.keywords.map((keyword) => keyword.keyword),
  ];

  for (const term of rawTerms) {
    for (const synonym of EXTRA_SYNONYMS[term] ?? []) {
      rawTerms.push(synonym);
    }
  }

  return Array.from(
    new Set(
      rawTerms
        .map(normalizeText)
        .map(stripGenericSuffix)
        .filter((term) => term.length >= 2 && !GENERIC_TERMS.has(term))
    )
  );
}

function scoreMatch(sector: SectorRow, etf: CnEtf): number {
  const name = normalizeText(etf.name);
  let score = 0;
  for (const term of sectorTerms(sector)) {
    if (!name.includes(term)) continue;
    score += term.length >= 4 ? 4 : term.length;
    if (normalizeText(sector.name).includes(term)) score += 1;
  }
  return score;
}

function rankValue(etf: CnEtf): number {
  return etf.rankValue ?? etf.marketValue ?? etf.amount ?? etf.volume ?? 0;
}

function rankRationale(etf: CnEtf, sectorName: string, score: number): string {
  const metric = etf.marketValue
    ? `规模/市值 ${Math.round(etf.marketValue)}`
    : etf.amount
      ? `成交额 ${Math.round(etf.amount)}`
      : etf.volume
        ? `成交量 ${Math.round(etf.volume)}`
        : "暂无规模字段";
  return `名称匹配「${sectorName}」相关主题，匹配分 ${score}，按${metric}排序`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const [sectors, etfs] = await Promise.all([loadCnSectors(), fetchCnEtfs()]);

  let linked = 0;
  let sectorsWithEtfs = 0;
  const touchedStockIds = new Set<string>();

  console.log(
    `Mapping ${sectors.length} CN sectors to ${etfs.length} ETFs` +
      `${options.dryRun ? " (dry run)" : ""}`
  );

  for (const sector of sectors) {
    const candidates = etfs
      .map((etf) => ({ etf, score: scoreMatch(sector, etf) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return rankValue(b.etf) - rankValue(a.etf);
      })
      .slice(0, options.maxPerSector);

    if (candidates.length === 0) continue;
    sectorsWithEtfs++;

    for (let i = 0; i < candidates.length; i++) {
      const { etf, score } = candidates[i];
      const rank = i + 1;

      if (options.dryRun) {
        linked++;
        continue;
      }

      const stock = await prisma.stock.upsert({
        where: { market_ticker: { market: "CN", ticker: etf.ticker } },
        update: {
          assetType: "ETF",
          currency: "CNY",
          companyName: etf.name,
          dataSymbol: etf.ticker,
          latestPrice:
            etf.latestPrice === null || etf.latestPrice === undefined
              ? undefined
              : new Prisma.Decimal(etf.latestPrice),
          priceUpdatedAt:
            etf.latestPrice === null || etf.latestPrice === undefined
              ? undefined
              : new Date(),
          cachedResponse: Prisma.JsonNull,
        },
        create: {
          market: "CN",
          ticker: etf.ticker,
          assetType: "ETF",
          currency: "CNY",
          dataSymbol: etf.ticker,
          companyName: etf.name,
          latestPrice:
            etf.latestPrice === null || etf.latestPrice === undefined
              ? undefined
              : new Prisma.Decimal(etf.latestPrice),
          priceUpdatedAt:
            etf.latestPrice === null || etf.latestPrice === undefined
              ? undefined
              : new Date(),
        },
        select: { id: true, sectorId: true },
      });
      touchedStockIds.add(stock.id);

      if (!stock.sectorId) {
        await prisma.stock.update({
          where: { id: stock.id },
          data: { sectorId: sector.id },
        });
      }

      await prisma.sectorEtf.upsert({
        where: {
          sectorId_ticker: {
            sectorId: sector.id,
            ticker: etf.ticker,
          },
        },
        update: {
          market: "CN",
          name: etf.name,
          rationale: rankRationale(etf, sector.name, score),
          rank,
        },
        create: {
          sectorId: sector.id,
          ticker: etf.ticker,
          market: "CN",
          name: etf.name,
          rationale: rankRationale(etf, sector.name, score),
          rank,
        },
      });

      for (const keyword of [etf.ticker, etf.name]) {
        await prisma.keywordMapping.upsert({
          where: {
            market_keyword: {
              market: "CN",
              keyword: keyword.toLowerCase(),
            },
          },
          update: { stockId: stock.id },
          create: {
            market: "CN",
            keyword: keyword.toLowerCase(),
            stockId: stock.id,
          },
        });
      }

      linked++;
    }
  }

  if (!options.dryRun && touchedStockIds.size > 0) {
    await prisma.stock.updateMany({
      where: { id: { in: Array.from(touchedStockIds) } },
      data: { cachedResponse: Prisma.JsonNull },
    });
  }

  console.log("\nDone.");
  console.table({
    sectors: sectors.length,
    etfs: etfs.length,
    sectorsWithEtfs,
    linked,
    touchedStocks: touchedStockIds.size,
  });
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
