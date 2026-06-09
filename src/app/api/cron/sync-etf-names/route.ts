import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyCronAuth } from "@/lib/cron-auth";

const SINA_ETF_LIST_URL =
  "https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData";

interface SinaEtfRow {
  symbol: string; // sh510300
  code: string;   // 510300
  name: string;   // ETF name
  trade?: string;
}

/**
 * Fetch all CN ETFs from Sina Finance (paginated).
 */
async function fetchAllCnEtfs(): Promise<{ ticker: string; market: string; name: string }[]> {
  const results: { ticker: string; market: string; name: string }[] = [];
  const perPage = 200;
  let page = 1;

  while (true) {
    const url = `${SINA_ETF_LIST_URL}?page=${page}&num=${perPage}&sort=symbol&asc=1&node=etf_hq_fund`;

    const resp = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Referer: "https://finance.sina.com.cn/",
      },
      signal: AbortSignal.timeout(30000),
    });

    if (!resp.ok) break;

    const text = await resp.text();
    if (!text || text.trim() === "null" || text.trim() === "[]") break;

    try {
      const rows = JSON.parse(text) as SinaEtfRow[];
      if (!Array.isArray(rows) || rows.length === 0) break;

      for (const row of rows) {
        const code = (row.code || "").trim();
        const name = (row.name || "").trim();
        if (!code || !name) continue;

        results.push({
          ticker: code,
          market: "CN",
          name,
        });
      }

      // Pagination: if fewer than perPage, we're done
      if (rows.length < perPage) break;
      page++;
    } catch {
      break;
    }
  }

  return results;
}

/**
 * Match ETF name against a sector's keywords to determine if it belongs.
 */
function etfMatchesSector(
  etfName: string,
  sectorKeywords: string[]
): { match: boolean; score: number } {
  let score = 0;
  for (const kw of sectorKeywords) {
    if (!kw) continue;
    if (etfName.includes(kw)) {
      // Longer keyword = stronger match
      score += kw.length;
    }
  }
  return { match: score > 0, score };
}

/**
 * POST /api/cron/sync-etf-names
 *
 * Fetches ALL CN ETFs from Sina Finance, matches them to sectors by name,
 * and creates SectorEtf records. Also updates stock company names.
 * Rate-limited to avoid overwhelming Sina.
 */
export async function POST(req: NextRequest) {
  const authError = verifyCronAuth(req);
  if (authError) return authError;

  try {
    // 1. Fetch all CN ETFs
    console.log("Fetching all CN ETFs from Sina...");
    const allEtfs = await fetchAllCnEtfs();
    console.log(`Fetched ${allEtfs.length} CN ETFs from Sina`);

    // 2. Load sectors with their keywords
    const sectors = await prisma.sector.findMany({
      where: { market: "CN" },
      include: { keywords: true, etfs: true },
    });

    // 3. Build name-based keyword matching for auto-categorization
    // Additional auto-keywords extracted from common ETF naming patterns
    const autoKeywords: Record<string, string[]> = {};
    for (const sector of sectors) {
      const kws = sector.keywords.map((k) => k.keyword);
      // Add sector name itself as a keyword
      kws.push(sector.name);
      autoKeywords[sector.id] = kws;
    }

    let etfLinked = 0;
    let etfNameUpdated = 0;
    let stockNameUpdated = 0;

    // 4. Match ETFs to sectors
    for (const sector of sectors) {
      const existingTickers = new Set(sector.etfs.map((e) => e.ticker));
      const kws = autoKeywords[sector.id] || [];

      // Find matching ETFs
      const matches = allEtfs.filter((etf) => {
        if (existingTickers.has(etf.ticker)) {
          // Already linked — check if name needs update
          const existing = sector.etfs.find((e) => e.ticker === etf.ticker);
          if (existing && existing.name !== etf.name) {
            return false; // handled below
          }
          return false;
        }
        return etfMatchesSector(etf.name, kws).match;
      });

      // Sort by name match score (best matches first)
      const scored = matches
        .map((etf) => ({ etf, score: etfMatchesSector(etf.name, kws).score }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 20); // max 20 ETFs per sector

      for (const { etf } of scored) {
        const rank = sector.etfs.length + etfLinked + 1;
        await prisma.sectorEtf.upsert({
          where: { sectorId_ticker: { sectorId: sector.id, ticker: etf.ticker } },
          update: { name: etf.name },
          create: {
            sectorId: sector.id,
            ticker: etf.ticker,
            market: "CN",
            name: etf.name,
            rationale: `名称匹配: ${etf.name}`,
            rank,
          },
        });
        etfLinked++;
      }
    }

    // 5. Update existing ETF names that have changed
    for (const sector of sectors) {
      for (const etf of sector.etfs) {
        const live = allEtfs.find((e) => e.ticker === etf.ticker);
        if (live && live.name !== etf.name) {
          await prisma.sectorEtf.update({
            where: { id: etf.id },
            data: { name: live.name },
          });
          etfNameUpdated++;
        }
      }
    }

    // 6. Update stock company names for CN ETFs
    const nameMap = new Map(allEtfs.map((e) => [e.ticker, e.name]));
    const cnEtfStocks = await prisma.stock.findMany({
      where: { market: "CN", assetType: "ETF" },
    });
    for (const stock of cnEtfStocks) {
      const liveName = nameMap.get(stock.ticker);
      if (liveName && liveName !== stock.companyName) {
        await prisma.stock.update({
          where: { id: stock.id },
          data: { companyName: liveName },
        });
        stockNameUpdated++;
      }
    }

    return NextResponse.json({
      ok: true,
      etfsFetched: allEtfs.length,
      etfLinked,
      etfNameUpdated,
      stockNameUpdated,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
