import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { verifyCronAuth } from "@/lib/cron-auth";
import { ingestPostsFromActiveBloggers } from "@/lib/ingest";
import { fetchDailyBars, fetchLatestPrice, fetchStockProfile } from "@/lib/market-data";
import { generateStockAnalysis } from "@/lib/kimi";
import { buildStockResponse } from "@/lib/stock-response";
import { normalizeMarket } from "@/lib/markets";
import { findPriceSyncStocks } from "@/lib/price-sync-selection";
import { backtestAllUnresearched } from "@/lib/backtest";
import { recalculateAllCredibility } from "@/lib/credibility";

const PROFILE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * GET/POST /api/cron/daily
 * Combined daily job: fetch-posts → sync-prices → update-latest
 * Supports GET for easy external cron service integration (e.g. cron-job.org)
 * Auth via ?secret= query param (GET) or Authorization header (POST)
 */
async function runDailyJob() {
  const results: Record<string, unknown> = {};

  // --- Step 1: Fetch posts ---
  try {
    results.fetchPosts = await ingestPostsFromActiveBloggers();
  } catch (err) {
    console.error("fetch-posts step failed:", err);
    results.fetchPosts = { error: String(err) };
  }

  // --- Step 2: Sync prices ---
  try {
    const stocks = await findPriceSyncStocks();
    let synced = 0;

    for (const stock of stocks) {
      try {
        const lastBar = await prisma.priceHistory.findFirst({
          where: { stockId: stock.id },
          orderBy: { date: "desc" },
        });
        const from = lastBar
          ? new Date(lastBar.date.getTime() + 86400000)
          : new Date(Date.now() - 180 * 86400000);
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
            where: { stockId_date: { stockId: stock.id, date: bar.date } },
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
    results.syncPrices = { synced, total: stocks.length };
  } catch (err) {
    console.error("sync-prices step failed:", err);
    results.syncPrices = { error: String(err) };
  }

  // --- Step 3: Update latest prices ---
  try {
    const stocks = await prisma.stock.findMany();
    let updated = 0;

    for (const stock of stocks) {
      try {
        // Rate-limit CN requests to avoid overwhelming Sina API
        if (stock.market === "CN" && updated > 0) {
          await new Promise((r) => setTimeout(r, 500));
        }

        const price = await fetchLatestPrice({
          ticker: stock.ticker,
          market: normalizeMarket(stock.market),
          assetType: stock.assetType === "ETF" ? "ETF" : "STOCK",
          dataSymbol: stock.dataSymbol,
        });
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
    results.updateLatest = { updated, total: stocks.length };
  } catch (err) {
    console.error("update-latest step failed:", err);
    results.updateLatest = { error: String(err) };
  }

  // --- Step 4: Sync Yahoo profiles ---
  try {
    const stocks = await prisma.stock.findMany();
    let synced = 0;

    for (const stock of stocks) {
      const stale =
        !stock.profileData ||
        !stock.profileUpdatedAt ||
        Date.now() - stock.profileUpdatedAt.getTime() > PROFILE_TTL_MS;
      if (!stale) continue;

      try {
        const profile = await fetchStockProfile({
          ticker: stock.ticker,
          market: normalizeMarket(stock.market),
          assetType: stock.assetType === "ETF" ? "ETF" : "STOCK",
          dataSymbol: stock.dataSymbol,
        });
        if (profile) {
          await prisma.stock.update({
            where: { id: stock.id },
            data: { profileData: profile as object, profileUpdatedAt: new Date() },
          });
          synced++;
        }
      } catch (err) {
        console.error(`Error syncing profile for ${stock.ticker}:`, err);
      }
    }
    results.syncProfiles = { synced, total: stocks.length };
  } catch (err) {
    console.error("sync-profiles step failed:", err);
    results.syncProfiles = { error: String(err) };
  }

  // --- Step 5: Generate Kimi analyses ---
  try {
    if (!process.env.KIMI_API_KEY && !process.env.DEEPSEEK_API_KEY) {
      results.generateAnalyses = { skipped: "no AI provider API key" };
    } else {
      const stocks = await prisma.stock.findMany({
        where: { analysis: null },
        select: { id: true, ticker: true, profileData: true },
      });
      let generated = 0;

      for (const stock of stocks) {
        if (!stock.profileData) continue;
        try {
          const content = await generateStockAnalysis(
            stock.ticker,
            stock.profileData as unknown as Parameters<typeof generateStockAnalysis>[1]
          );
          if (content) {
            await prisma.stockAnalysis.create({
              data: { stockId: stock.id, content },
            });
            generated++;
          }
        } catch (err) {
          console.error(`Error generating analysis for ${stock.ticker}:`, err);
        }
      }
      results.generateAnalyses = { generated, total: stocks.length };
    }
  } catch (err) {
    console.error("generate-analyses step failed:", err);
    results.generateAnalyses = { error: String(err) };
  }

  // --- Step 6: Pre-warm DB response cache ---
  try {
    const allStocks = await prisma.stock.findMany({ select: { ticker: true, market: true } });
    let warmed = 0;

    for (const s of allStocks) {
      try {
        const data = await buildStockResponse(s.ticker, normalizeMarket(s.market));
        if (data) {
          await prisma.stock.update({
            where: { market_ticker: { market: normalizeMarket(s.market), ticker: s.ticker } },
            data: { cachedResponse: data as object },
          });
          warmed++;
        }
      } catch (err) {
        console.error(`Error pre-warming cache for ${s.ticker}:`, err);
      }
    }
    results.prewarmCache = { warmed, total: allStocks.length };
  } catch (err) {
    console.error("prewarm-cache step failed:", err);
    results.prewarmCache = { error: String(err) };
  }

  // --- Step 7: Backtest predictions ---
  try {
    // Backtest CN market predictions that are 7+ days old
    const cnResult = await backtestAllUnresearched("CN", 7);
    const usResult = await backtestAllUnresearched("US", 7);
    results.backtestOpinions = {
      cn: cnResult,
      us: usResult,
    };
  } catch (err) {
    console.error("backtest-opinions step failed:", err);
    results.backtestOpinions = { error: String(err) };
  }

  // --- Step 8: Recalculate credibility ---
  try {
    const cnCount = await recalculateAllCredibility("CN");
    const usCount = await recalculateAllCredibility("US");
    results.calculateCredibility = { cnUpdated: cnCount, usUpdated: usCount };
  } catch (err) {
    console.error("calculate-credibility step failed:", err);
    results.calculateCredibility = { error: String(err) };
  }

  return results;
}

async function handler(req: NextRequest) {
  // Support auth via query param for GET requests (cron-job.org style)
  const secretParam = req.nextUrl.searchParams.get("secret");
  if (secretParam) {
    const expected = process.env.CRON_SECRET;
    if (!expected || secretParam !== expected) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  } else {
    const authError = verifyCronAuth(req);
    if (authError) return authError;
  }

  // Return immediately so cron-job.org doesn't timeout; job runs in background
  runDailyJob().catch((err) => console.error("daily job failed:", err));

  return NextResponse.json({ ok: true, status: "running" });
}

export const GET = handler;
export const POST = handler;
