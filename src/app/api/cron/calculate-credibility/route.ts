import { NextRequest, NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cron-auth";
import { recalculateAllCredibility } from "@/lib/credibility";

/**
 * POST /api/cron/calculate-credibility
 *
 * Recalculates credibility scores for all blogger-sector pairs.
 * Should run after backtesting completes.
 */
export async function POST(req: NextRequest) {
  const authError = verifyCronAuth(req);
  if (authError) return authError;

  const market = req.nextUrl.searchParams.get("market") ?? "CN";

  try {
    const count = await recalculateAllCredibility(market);
    return NextResponse.json({ ok: true, updated: count });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Credibility calculation failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
