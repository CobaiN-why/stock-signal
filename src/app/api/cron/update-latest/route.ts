import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyCronAuth } from "@/lib/cron-auth";
import { fetchLatestPrice } from "@/lib/yahoo";

export async function POST(req: NextRequest) {
  const authError = verifyCronAuth(req);
  if (authError) return authError;

  const stocks = await prisma.stock.findMany({
    where: { postStocks: { some: {} } },
  });

  let updated = 0;

  for (const stock of stocks) {
    try {
      const price = await fetchLatestPrice(stock.ticker);
      if (price !== null) {
        await prisma.stock.update({
          where: { id: stock.id },
          data: { latestPrice: price, priceUpdatedAt: new Date() },
        });
        updated++;
      }
    } catch (err) {
      console.error(`Error updating price for ${stock.ticker}:`, err);
    }
  }

  return NextResponse.json({ updated, total: stocks.length });
}
