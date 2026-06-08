import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import cnInstruments from "../src/data/cn-instruments.json";
import keywords from "../src/data/keywords.json";
import sectors from "../src/data/sectors.json";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  for (const [ticker, kws] of Object.entries(keywords)) {
    const stock = await prisma.stock.upsert({
      where: { market_ticker: { market: "US", ticker } },
      update: {},
      create: {
        market: "US",
        ticker,
        assetType: "STOCK",
        currency: "USD",
        companyName: kws[0] || ticker,
      },
    });

    for (const kw of kws) {
      await prisma.keywordMapping.upsert({
        where: { market_keyword: { market: "US", keyword: kw.toLowerCase() } },
        update: {},
        create: { market: "US", keyword: kw.toLowerCase(), stockId: stock.id },
      });
    }
  }

  for (const instrument of cnInstruments) {
    const stock = await prisma.stock.upsert({
      where: { market_ticker: { market: "CN", ticker: instrument.ticker } },
      update: {
        assetType: instrument.assetType,
        currency: "CNY",
        companyName: instrument.name,
        dataSymbol: instrument.ticker,
      },
      create: {
        market: "CN",
        ticker: instrument.ticker,
        assetType: instrument.assetType,
        currency: "CNY",
        dataSymbol: instrument.ticker,
        companyName: instrument.name,
      },
    });

    for (const kw of instrument.keywords) {
      await prisma.keywordMapping.upsert({
        where: { market_keyword: { market: "CN", keyword: kw.toLowerCase() } },
        update: { stockId: stock.id },
        create: { market: "CN", keyword: kw.toLowerCase(), stockId: stock.id },
      });
    }
  }

  for (const sectorConfig of sectors) {
    const sector = await prisma.sector.upsert({
      where: {
        market_slug: {
          market: sectorConfig.market,
          slug: sectorConfig.slug,
        },
      },
      update: {
        name: sectorConfig.name,
        description: sectorConfig.description,
      },
      create: {
        market: sectorConfig.market,
        slug: sectorConfig.slug,
        name: sectorConfig.name,
        description: sectorConfig.description,
      },
    });

    for (const keyword of sectorConfig.keywords) {
      await prisma.sectorKeyword.upsert({
        where: {
          sectorId_keyword: {
            sectorId: sector.id,
            keyword: keyword.toLowerCase(),
          },
        },
        update: {},
        create: {
          sectorId: sector.id,
          keyword: keyword.toLowerCase(),
        },
      });
    }

    for (const ticker of sectorConfig.stockTickers) {
      await prisma.stock.updateMany({
        where: { market: sectorConfig.market, ticker },
        data: { sectorId: sector.id },
      });
    }

    for (const etf of sectorConfig.etfs) {
      await prisma.stock.upsert({
        where: {
          market_ticker: {
            market: sectorConfig.market,
            ticker: etf.ticker,
          },
        },
        update: {
          assetType: "ETF",
          currency: sectorConfig.market === "US" ? "USD" : "CNY",
          companyName: etf.name,
          dataSymbol: etf.ticker,
          sectorId: sector.id,
        },
        create: {
          market: sectorConfig.market,
          ticker: etf.ticker,
          assetType: "ETF",
          currency: sectorConfig.market === "US" ? "USD" : "CNY",
          dataSymbol: etf.ticker,
          companyName: etf.name,
          sectorId: sector.id,
        },
      });

      await prisma.sectorEtf.upsert({
        where: {
          sectorId_ticker: {
            sectorId: sector.id,
            ticker: etf.ticker,
          },
        },
        update: {
          market: sectorConfig.market,
          name: etf.name,
          rationale: etf.rationale,
          rank: etf.rank,
        },
        create: {
          sectorId: sector.id,
          ticker: etf.ticker,
          market: sectorConfig.market,
          name: etf.name,
          rationale: etf.rationale,
          rank: etf.rank,
        },
      });
    }
  }

  console.log(
    `Seeded ${Object.keys(keywords).length} US stocks, ${cnInstruments.length} CN instruments, ${sectors.length} sectors, and ETF recommendations`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
