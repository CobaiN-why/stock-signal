import { prisma } from "@/lib/db";

export type BacktestResult = "correct" | "incorrect" | "neutral";

const NEUTRAL_THRESHOLD = 1.0; // price movement less than 1% = neutral

/**
 * Find the closest trading day's closing price on or before a given date.
 * Falls back to the first price after the date if no price before exists.
 */
async function findPriceNear(
  stockId: string,
  targetDate: Date
): Promise<{ date: Date; close: number } | null> {
  // Try to find price on or before target date
  const before = await prisma.priceHistory.findFirst({
    where: {
      stockId,
      date: { lte: targetDate },
    },
    orderBy: { date: "desc" },
    select: { date: true, close: true },
  });

  if (before) return { date: before.date, close: Number(before.close) };

  // Fallback: first price after target date
  const after = await prisma.priceHistory.findFirst({
    where: {
      stockId,
      date: { gte: targetDate },
    },
    orderBy: { date: "asc" },
    select: { date: true, close: true },
  });

  return after ? { date: after.date, close: Number(after.close) } : null;
}

/**
 * Find the reference stock for backtesting a prediction.
 * For PostStock: use the stock directly.
 * For PostSector: use the highest-ranked ETF in that sector.
 */
async function findReferenceStock(
  postStockId: string | null,
  postSectorId: string | null
): Promise<{ stockId: string; ticker: string; market: string } | null> {
  if (postStockId) {
    const ps = await prisma.postStock.findUnique({
      where: { id: postStockId },
      include: { stock: { select: { id: true, ticker: true, market: true } } },
    });
    if (!ps) return null;
    return {
      stockId: ps.stock.id,
      ticker: ps.stock.ticker,
      market: ps.stock.market,
    };
  }

  if (postSectorId) {
    const ps = await prisma.postSector.findUnique({
      where: { id: postSectorId },
      include: {
        sector: {
          include: {
            etfs: { orderBy: { rank: "asc" }, take: 1 },
          },
        },
      },
    });
    if (!ps || ps.sector.etfs.length === 0) return null;

    const etf = ps.sector.etfs[0];
    // Find the stock record for this ETF
    const stock = await prisma.stock.findUnique({
      where: { market_ticker: { market: etf.market, ticker: etf.ticker } },
      select: { id: true, ticker: true, market: true },
    });
    return stock
      ? { stockId: stock.id, ticker: stock.ticker, market: stock.market }
      : null;
  }

  return null;
}

/**
 * Classify a backtest result based on prediction direction and price return.
 */
function classifyResult(
  prediction: string,
  returnPct: number
): BacktestResult {
  if (Math.abs(returnPct) < NEUTRAL_THRESHOLD) return "neutral";

  if (prediction === "bullish") {
    return returnPct > 0 ? "correct" : "incorrect";
  }
  if (prediction === "bearish") {
    return returnPct < 0 ? "correct" : "incorrect";
  }
  return "neutral";
}

/**
 * Backtest a single prediction (PostStock or PostSector).
 *
 * Process:
 * 1. Find the reference stock (direct stock or sector's primary ETF)
 * 2. Find price at prediction date
 * 3. Find price windowDays later
 * 4. Calculate return and classify result
 * 5. Create OpinionBacktest record
 */
export async function backtestPrediction(
  postStockId: string | null,
  postSectorId: string | null,
  windowDays: number = 7
): Promise<{
  success: boolean;
  result?: BacktestResult;
  returnPct?: number;
  error?: string;
}> {
  // Determine prediction details
  let prediction: string | null = null;
  let madeAt: Date;

  if (postStockId) {
    const ps = await prisma.postStock.findUnique({
      where: { id: postStockId },
      include: { post: { select: { postedAt: true } } },
    });
    if (!ps) return { success: false, error: "PostStock not found" };
    if (!ps.sentiment)
      return { success: false, error: "No sentiment on PostStock" };
    prediction = ps.sentiment;
    madeAt = ps.post.postedAt;
  } else if (postSectorId) {
    const ps = await prisma.postSector.findUnique({
      where: { id: postSectorId },
      include: { post: { select: { postedAt: true } } },
    });
    if (!ps) return { success: false, error: "PostSector not found" };
    if (!ps.sentiment)
      return { success: false, error: "No sentiment on PostSector" };
    prediction = ps.sentiment;
    madeAt = ps.post.postedAt;
  } else {
    return { success: false, error: "Neither postStockId nor postSectorId provided" };
  }

  // Find reference stock
  const ref = await findReferenceStock(postStockId, postSectorId);
  if (!ref)
    return {
      success: false,
      error: "No reference stock/ETF found for backtest",
    };

  // Find prices
  const priceBefore = await findPriceNear(ref.stockId, madeAt);
  if (!priceBefore)
    return {
      success: false,
      error: `No price data for ${ref.ticker} near ${madeAt.toISOString()}`,
    };

  const targetDate = new Date(madeAt.getTime() + windowDays * 24 * 60 * 60 * 1000);
  const priceAfter = await findPriceNear(ref.stockId, targetDate);
  if (!priceAfter)
    return {
      success: false,
      error: `No price data for ${ref.ticker} near ${targetDate.toISOString()}`,
    };

  // Calculate return
  const returnPct =
    ((Number(priceAfter.close) - Number(priceBefore.close)) /
      Number(priceBefore.close)) *
    100;
  const result = classifyResult(prediction, returnPct);

  // Write backtest record
  await prisma.opinionBacktest.create({
    data: {
      postStockId,
      postSectorId,
      prediction,
      madeAt,
      evaluatedAt: new Date(),
      windowDays,
      priceBefore: priceBefore.close,
      priceAfter: priceAfter.close,
      returnPct: Math.round(returnPct * 100) / 100,
      result,
    },
  });

  return {
    success: true,
    result,
    returnPct: Math.round(returnPct * 100) / 100,
  };
}

/**
 * Run backtesting for all unevaluated predictions older than windowDays.
 * Called by cron after market data sync.
 */
export async function backtestAllUnresearched(
  market: string,
  windowDays: number = 7
): Promise<{ evaluated: number; skipped: number; errors: number }> {
  const cutoff = new Date(
    Date.now() - windowDays * 24 * 60 * 60 * 1000
  );

  // Find PostStock records that need backtesting
  const unevaluatedPostStocks = await prisma.postStock.findMany({
    where: {
      sentiment: { not: null },
      post: {
        postedAt: { lte: cutoff },
        blogger: { market },
      },
      backtests: { none: {} },
    },
    select: { id: true },
  });

  // Find PostSector records that need backtesting
  const unevaluatedPostSectors = await prisma.postSector.findMany({
    where: {
      sentiment: { not: null },
      post: {
        postedAt: { lte: cutoff },
        blogger: { market },
      },
      backtests: { none: {} },
    },
    select: { id: true },
  });

  let evaluated = 0;
  let skipped = 0;
  let errors = 0;

  for (const ps of unevaluatedPostStocks) {
    const r = await backtestPrediction(ps.id, null, windowDays);
    if (r.success) evaluated++;
    else if (r.error?.includes("No price data")) skipped++;
    else errors++;
  }

  for (const ps of unevaluatedPostSectors) {
    const r = await backtestPrediction(null, ps.id, windowDays);
    if (r.success) evaluated++;
    else if (r.error?.includes("No price data")) skipped++;
    else errors++;
  }

  return { evaluated, skipped, errors };
}
