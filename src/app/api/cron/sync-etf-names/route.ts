import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyCronAuth } from "@/lib/cron-auth";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function pythonPath(): string {
  return process.env.CN_MARKET_DATA_PYTHON || "python3";
}

/**
 * POST /api/cron/sync-etf-names
 * Updates all CN ETF names from live akshare data.
 */
export async function POST(req: NextRequest) {
  const authError = verifyCronAuth(req);
  if (authError) return authError;

  const pyScript = `
import akshare as ak, json, sys, warnings
warnings.filterwarnings("ignore")
df = ak.fund_etf_spot_em()
m = {}
for _, r in df.iterrows():
    c = str(r["代码"]).strip()
    n = str(r["名称"]).strip()
    if c and n: m[c] = n
json.dump(m, sys.stdout, ensure_ascii=False)
`;

  try {
    const { stdout } = await execFileAsync(pythonPath(), ["-c", pyScript], {
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    const nameMap: Record<string, string> = JSON.parse(stdout);

    let etfUpdated = 0;
    let stockUpdated = 0;

    // Update SectorEtf
    const etfs = await prisma.sectorEtf.findMany({ where: { market: "CN" } });
    for (const etf of etfs) {
      const live = nameMap[etf.ticker];
      if (live && live !== etf.name) {
        await prisma.sectorEtf.update({ where: { id: etf.id }, data: { name: live } });
        etfUpdated++;
      }
    }

    // Update Stock companyName
    const stocks = await prisma.stock.findMany({
      where: { market: "CN", assetType: "ETF" },
    });
    for (const stock of stocks) {
      const live = nameMap[stock.ticker];
      if (live && live !== stock.companyName) {
        await prisma.stock.update({
          where: { id: stock.id },
          data: { companyName: live },
        });
        stockUpdated++;
      }
    }

    return NextResponse.json({
      ok: true,
      namesFetched: Object.keys(nameMap).length,
      etfNamesUpdated: etfUpdated,
      stockNamesUpdated: stockUpdated,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
