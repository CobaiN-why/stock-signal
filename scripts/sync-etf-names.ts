import { execFileSync } from "node:child_process";
import { prisma } from "@/lib/db";

const pythonCmd = process.env.CN_MARKET_DATA_PYTHON || "python3";

async function main() {
  console.log("Fetching live ETF names from akshare...");

  const script = `
import akshare as ak, json, sys, warnings
warnings.filterwarnings("ignore")
df = ak.fund_etf_spot_em()
name_map = {}
for _, row in df.iterrows():
    code = str(row.get("代码", "")).strip()
    name = str(row.get("名称", "")).strip()
    if code and name:
        name_map[code] = name
json.dump(name_map, sys.stdout, ensure_ascii=False)
`;

  const stdout = execFileSync(pythonCmd, ["-c", script], {
    encoding: "utf-8",
    timeout: 60_000,
  });
  const nameMap: Record<string, string> = JSON.parse(stdout);
  console.log(`Fetched ${Object.keys(nameMap).length} ETF names`);

  // Update SectorEtf names
  const etfs = await prisma.sectorEtf.findMany({ where: { market: "CN" } });
  let updatedEtf = 0;
  for (const etf of etfs) {
    const liveName = nameMap[etf.ticker];
    if (liveName && liveName !== etf.name) {
      await prisma.sectorEtf.update({
        where: { id: etf.id },
        data: { name: liveName },
      });
      console.log(`  SectorEtf ${etf.ticker}: "${etf.name}" → "${liveName}"`);
      updatedEtf++;
    }
  }

  // Update Stock companyName for ETFs
  const stocks = await prisma.stock.findMany({
    where: { market: "CN", assetType: "ETF" },
  });
  let updatedStock = 0;
  for (const stock of stocks) {
    const liveName = nameMap[stock.ticker];
    if (liveName && liveName !== stock.companyName) {
      await prisma.stock.update({
        where: { id: stock.id },
        data: { companyName: liveName },
      });
      console.log(`  Stock ${stock.ticker}: "${stock.companyName}" → "${liveName}"`);
      updatedStock++;
    }
  }

  console.log(`Done. Updated ${updatedEtf} SectorEtf names, ${updatedStock} Stock names.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
