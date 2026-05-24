import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import keywords from "../src/data/keywords.json";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  for (const [ticker, kws] of Object.entries(keywords)) {
    const stock = await prisma.stock.upsert({
      where: { ticker },
      update: {},
      create: { ticker, companyName: kws[0] || ticker },
    });

    for (const kw of kws) {
      await prisma.keywordMapping.upsert({
        where: { keyword: kw.toLowerCase() },
        update: {},
        create: { keyword: kw.toLowerCase(), stockId: stock.id },
      });
    }
  }

  console.log(`Seeded ${Object.keys(keywords).length} stocks with keyword mappings`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
