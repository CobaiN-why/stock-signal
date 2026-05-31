import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { buildStockResponse } from "@/lib/stock-response";

const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12h — data only updates once per day via cron

// In-memory response cache — cleared on server restart (deploy), so long TTL is safe
const responseCache = new Map<string, { data: object; ts: number }>();

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker } = await params;
  const key = ticker.toUpperCase();

  // Layer 1: in-memory cache
  const cached = responseCache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return NextResponse.json(cached.data);
  }

  // Layer 2: DB cached_response (single-column lookup, no joins)
  const row = await prisma.stock.findUnique({
    where: { ticker: key },
    select: { cachedResponse: true },
  });

  if (!row) {
    return NextResponse.json({ error: "Stock not found" }, { status: 404 });
  }

  if (row.cachedResponse) {
    const data = row.cachedResponse as object;
    responseCache.set(key, { data, ts: Date.now() });
    return NextResponse.json(data);
  }

  // Layer 3: fallback — full query (new stock or first deploy before cron runs)
  const data = await buildStockResponse(key);
  if (!data) {
    return NextResponse.json({ error: "Stock not found" }, { status: 404 });
  }

  responseCache.set(key, { data, ts: Date.now() });
  return NextResponse.json(data);
}
