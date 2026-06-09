import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  STOCK_RESPONSE_SCHEMA_VERSION,
  buildStockResponse,
} from "@/lib/stock-response";
import { normalizeMarket } from "@/lib/markets";

const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12h — data only updates once per day via cron

// In-memory response cache — cleared on server restart (deploy), so long TTL is safe
const responseCache = new Map<string, { data: object; ts: number }>();

function hasPrices(data: object): boolean {
  return (
    "prices" in data &&
    Array.isArray(data.prices) &&
    data.prices.length > 0
  );
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker } = await params;
  const market = normalizeMarket(req.nextUrl.searchParams.get("market"));
  const key = ticker.toUpperCase();
  const cacheKey = `${market}:${key}`;

  // Layer 1: in-memory cache
  const cached = responseCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS && hasPrices(cached.data)) {
    return NextResponse.json(cached.data);
  }

  // Layer 2: DB cached_response (single-column lookup, no joins)
  const row = await prisma.stock.findUnique({
    where: { market_ticker: { market, ticker: key } },
    select: { cachedResponse: true },
  });

  if (!row) {
    return NextResponse.json({ error: "Stock not found" }, { status: 404 });
  }

  if (
    row.cachedResponse &&
    typeof row.cachedResponse === "object" &&
    !Array.isArray(row.cachedResponse) &&
    "schemaVersion" in row.cachedResponse &&
    row.cachedResponse.schemaVersion === STOCK_RESPONSE_SCHEMA_VERSION &&
    hasPrices(row.cachedResponse)
  ) {
    const data = row.cachedResponse as object;
    responseCache.set(cacheKey, { data, ts: Date.now() });
    return NextResponse.json(data);
  }

  // Layer 3: fallback — full query (new stock or first deploy before cron runs)
  const data = await buildStockResponse(key, market);
  if (!data) {
    return NextResponse.json({ error: "Stock not found" }, { status: 404 });
  }

  if (hasPrices(data)) {
    responseCache.set(cacheKey, { data, ts: Date.now() });
  }
  return NextResponse.json(data);
}
