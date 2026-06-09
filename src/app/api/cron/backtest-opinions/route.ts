import { NextRequest, NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cron-auth";
import { backtestAllUnresearched } from "@/lib/backtest";

/**
 * POST /api/cron/backtest-opinions
 *
 * Evaluates all predictions older than 7 days that haven't been backtested yet.
 * Compares prediction direction against actual price movement.
 */
export async function POST(req: NextRequest) {
  const authError = verifyCronAuth(req);
  if (authError) return authError;

  const market = req.nextUrl.searchParams.get("market") ?? "CN";
  const windowDays = Number(req.nextUrl.searchParams.get("windowDays") ?? "7");

  try {
    const result = await backtestAllUnresearched(market, windowDays);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Backtest cron failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
