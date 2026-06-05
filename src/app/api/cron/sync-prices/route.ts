import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyCronAuth } from "@/lib/cron-auth";
import { fetchDailyBars } from "@/lib/market-data";
import { normalizeMarket } from "@/lib/markets";

export async function POST(req: NextRequest) {
  const authError = verifyCronAuth(req);
  if (authError) return authError;

  const stocks = await prisma.stock.findMany({
    where: { postStocks: { some: {} } },
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

      synced++;
    } catch (err) {
      console.error(`Error syncing prices for ${stock.ticker}:`, err);
    }
  }

  return NextResponse.json({ synced, total: stocks.length });
}
