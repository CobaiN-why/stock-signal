import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { verifyCronAuth } from "@/lib/cron-auth";
import { fetchDailyBars } from "@/lib/market-data";
import { normalizeMarket } from "@/lib/markets";
import { findPriceSyncStocks } from "@/lib/price-sync-selection";

export async function POST(req: NextRequest) {
  const authError = verifyCronAuth(req);
  if (authError) return authError;

  const marketParam = req.nextUrl.searchParams.get("market");
  const tickerParam = req.nextUrl.searchParams.get("ticker")?.toUpperCase();
  const includeSeeded = req.nextUrl.searchParams.get("includeSeeded") === "true";
  const market = marketParam ? normalizeMarket(marketParam) : null;

  const stocks = await findPriceSyncStocks({
    market,
    ticker: tickerParam,
    includeSeeded,
  });

  let synced = 0;

  for (const stock of stocks) {
    try {
      const lastBar = await prisma.priceHistory.findFirst({
        where: { stockId: stock.id },
        orderBy: { date: "desc" },
      });

      const from = lastBar
        ? new Date(lastBar.date.getTime() + 86400000)
        : new Date(Date.now() - 180 * 86400000); // 6 months back

      const to = new Date();
      if (from >= to) continue;

      const bars = await fetchDailyBars(
        {
          ticker: stock.ticker,
          market: normalizeMarket(stock.market),
          assetType: stock.assetType === "ETF" ? "ETF" : "STOCK",
          dataSymbol: stock.dataSymbol,
        },
        from,
        to
      );

      for (const bar of bars) {
        await prisma.priceHistory.upsert({
          where: {
            stockId_date: { stockId: stock.id, date: bar.date },
          },
          update: {
            open: bar.open,
            high: bar.high,
            low: bar.low,
            close: bar.close,
            volume: bar.volume,
          },
          create: {
            stockId: stock.id,
            date: bar.date,
            open: bar.open,
            high: bar.high,
            low: bar.low,
            close: bar.close,
            volume: bar.volume,
          },
        });
      }

      if (bars.length > 0) {
        await prisma.stock.update({
          where: { id: stock.id },
          data: { cachedResponse: Prisma.JsonNull },
        });
        synced++;
      }
    } catch (err) {
      console.error(`Error syncing prices for ${stock.ticker}:`, err);
    }
  }

  return NextResponse.json({ synced, total: stocks.length });
}
