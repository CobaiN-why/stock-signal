import { prisma } from "../src/lib/db.js";
import { fetchStockProfile } from "../src/lib/market-data/index.js";
import { generateStockAnalysis } from "../src/lib/kimi.js";
import { normalizeMarket } from "../src/lib/markets.js";

async function main() {
  // Step 1: backfill missing profiles (all stocks)
  const allStocks = await prisma.stock.findMany({
    select: {
      id: true,
      ticker: true,
      market: true,
      assetType: true,
      dataSymbol: true,
      profileData: true,
      profileUpdatedAt: true,
    },
  });
  const noProfile = allStocks.filter((s) => !s.profileData);
  console.log(`Backfilling ${noProfile.length} / ${allStocks.length} profiles...`);

  for (const s of noProfile) {
    try {
      const p = await fetchStockProfile({
        ticker: s.ticker,
        market: normalizeMarket(s.market),
        assetType: s.assetType === "ETF" ? "ETF" : "STOCK",
        dataSymbol: s.dataSymbol,
      });
      if (p) {
        await prisma.stock.update({
          where: { id: s.id },
          data: { profileData: p as object, profileUpdatedAt: new Date() },
        });
        console.log("✓ profile", s.ticker, p.shortName || p.longName);
      } else {
        console.log("✗ profile", s.ticker, "no data returned");
      }
    } catch (e) {
      console.log("✗ profile", s.ticker, (e as Error).message.slice(0, 80));
    }
  }

  // Step 2: generate missing analyses
  const withProfile = await prisma.stock.findMany({
    where: { analysis: null },
    select: { id: true, ticker: true, profileData: true },
  });
  const needAnalysis = withProfile.filter((s) => s.profileData);
  console.log(`\nGenerating ${needAnalysis.length} analyses...`);

  for (const s of needAnalysis) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const content = await generateStockAnalysis(s.ticker, s.profileData as any);
      if (content) {
        await prisma.stockAnalysis.create({ data: { stockId: s.id, content } });
        console.log("✓ analysis", s.ticker);
      }
    } catch (e) {
      console.log("✗ analysis", s.ticker, (e as Error).message.slice(0, 80));
    }
  }

  await prisma.$disconnect();
  console.log("\nDone.");
}

main();
