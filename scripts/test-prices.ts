/**
 * Test Twelve Data (bars) + Finnhub (quote/profile) against all tracked tickers.
 * Run: npx tsx scripts/test-prices.ts
 */

import { fetchDailyBars, fetchLatestPrice, fetchStockProfile } from "../src/lib/yahoo";

async function main() {
  // From Railway error logs + common stocks for coverage check
  const tickers = ["AAOI", "BABA", "RPI", "SIVE", "LPK", "AAPL", "TSLA", "NVDA"];
  console.log(`Testing ${tickers.length} tickers: ${tickers.join(", ")}\n`);

  const from = new Date(Date.now() - 7 * 86400_000); // last 7 days
  const to = new Date();

  const results: { ticker: string; bars: string; price: string; profile: string }[] = [];

  for (const ticker of tickers) {
    let bars = "";
    let price = "";
    let profile = "";

    try {
      const data = await fetchDailyBars(ticker, from, to);
      bars = data.length > 0 ? `✅ ${data.length} bars` : "⚠️  no data";
    } catch (e) {
      bars = `❌ ${String(e).slice(0, 80)}`;
    }

    try {
      const p = await fetchLatestPrice(ticker);
      price = p != null ? `✅ $${p}` : "⚠️  null";
    } catch (e) {
      price = `❌ ${String(e).slice(0, 80)}`;
    }

    try {
      const p = await fetchStockProfile(ticker);
      profile = p ? `✅ ${p.shortName}` : "⚠️  null";
    } catch (e) {
      profile = `❌ ${String(e).slice(0, 80)}`;
    }

    results.push({ ticker, bars, price, profile });
    process.stdout.write(`${ticker}: bars=${bars} | price=${price} | profile=${profile}\n`);

    // Small delay to respect rate limits (8 req/min for Twelve Data)
    await new Promise((r) => setTimeout(r, 500));
  }

  const failed = results.filter(
    (r) => r.bars.startsWith("❌") || r.price.startsWith("❌") || r.profile.startsWith("❌")
  );
  console.log(`\n--- Summary ---`);
  console.log(`Total: ${results.length} | Failed: ${failed.length}`);
  if (failed.length) {
    console.log("Failed tickers:", failed.map((r) => r.ticker).join(", "));
  }

}

main().catch(console.error);
