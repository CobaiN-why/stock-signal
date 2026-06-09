import { NextRequest, NextResponse } from "next/server";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function pythonPath(): string {
  return process.env.CN_MARKET_DATA_PYTHON || "python3";
}

function scriptPath(): string {
  return path.join(process.cwd(), "scripts", "cn-akshare-provider.py");
}

/**
 * GET /api/market/fund-flow?market=CN
 * Returns sector capital flow rankings for today.
 */
export async function GET(req: NextRequest) {
  const market = req.nextUrl.searchParams.get("market") ?? "CN";

  if (market !== "CN") {
    return NextResponse.json(
      { error: "Only CN market fund flow is supported" },
      { status: 400 }
    );
  }

  try {
    const { stdout } = await execFileAsync(pythonPath(), [scriptPath(), "flow"], {
      timeout: 120_000,
      maxBuffer: 1024 * 1024 * 10,
    });
    const data = JSON.parse(stdout);

    // Sort by net flow descending
    const topInflow = [...data.industry]
      .sort((a, b) => b.net_flow - a.net_flow)
      .slice(0, 10);
    const topOutflow = [...data.industry]
      .sort((a, b) => a.net_flow - b.net_flow)
      .slice(0, 10);

    return NextResponse.json({
      timestamp: data.timestamp,
      topInflow: topInflow.map((i) => ({
        name: i.name,
        netFlow: Math.round(i.net_flow * 100) / 100,
        changePct: Math.round(i.change_pct * 100) / 100,
        inflow: Math.round(i.inflow * 100) / 100,
        outflow: Math.round(i.outflow * 100) / 100,
        leadStock: i.lead_stock,
      })),
      topOutflow: topOutflow.map((i) => ({
        name: i.name,
        netFlow: Math.round(i.net_flow * 100) / 100,
        changePct: Math.round(i.change_pct * 100) / 100,
        inflow: Math.round(i.inflow * 100) / 100,
        outflow: Math.round(i.outflow * 100) / 100,
        leadStock: i.lead_stock,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Fund flow fetch failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
