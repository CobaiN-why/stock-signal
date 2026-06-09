import { prisma } from "@/lib/db";

/**
 * Credibility scoring algorithm for a single blogger on a single sector.
 *
 * Composite score (0-100):
 *   40% accuracy  — how often predictions were correct
 *   20% consistency — how regularly the blogger covers this sector
 *   15% recency    — how fresh the blogger's predictions are
 *   15% confidence — average confidence level of predictions
 *   10% volume     — total number of predictions
 *
 * Confidence labels:
 *   >= 70 : 高 (High)
 *   40-69 : 中 (Medium)
 *   < 40  : 低 (Low)
 */

export type ConfidenceLabel = "高" | "中" | "低";

export interface CredibilityScore {
  score: number;
  accuracyRate: number | null;
  totalPredictions: number;
  correctPredictions: number;
  avgConfidence: number | null;
  label: ConfidenceLabel;
}

export function classifyConfidence(score: number): ConfidenceLabel {
  if (score >= 70) return "高";
  if (score >= 40) return "中";
  return "低";
}

/**
 * Calculate credibility for ONE blogger-sector pair.
 * Requires backtest data to already exist in opinion_backtests.
 */
export async function calculateSectorCredibility(
  bloggerId: string,
  sectorId: string,
  market: string
): Promise<CredibilityScore> {
  // Fetch all PostSector records for this blogger + sector
  const postSectors = await prisma.postSector.findMany({
    where: {
      sectorId,
      sentiment: { not: null },
      post: { bloggerId, blogger: { market } },
    },
    include: {
      backtests: { take: 1 },
      post: { select: { postedAt: true } },
    },
  });

  const totalPredictions = postSectors.length;

  if (totalPredictions === 0) {
    return {
      score: 0,
      accuracyRate: null,
      totalPredictions: 0,
      correctPredictions: 0,
      avgConfidence: null,
      label: "低",
    };
  }

  // --- Accuracy (40%) ---
  let correctPredictions = 0;
  let evaluatedPredictions = 0;
  for (const ps of postSectors) {
    const bt = ps.backtests[0];
    if (bt && bt.result !== "neutral") {
      evaluatedPredictions++;
      if (bt.result === "correct") correctPredictions++;
    }
  }
  const accuracyRate =
    evaluatedPredictions > 0 ? correctPredictions / evaluatedPredictions : 0;
  const accuracyComponent = accuracyRate * 40;

  // --- Consistency (20%) — posts in last 90 days ---
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const recentPosts = postSectors.filter(
    (ps) => ps.post.postedAt >= ninetyDaysAgo
  ).length;
  const consistencyComponent = Math.min(recentPosts / 15, 1.0) * 20;

  // --- Recency (15%) — fresher predictions count more ---
  const now = Date.now();
  let recencyScore = 0;
  let recencyWeightTotal = 0;
  for (const ps of postSectors) {
    const daysAgo =
      (now - ps.post.postedAt.getTime()) / (24 * 60 * 60 * 1000);
    const weight = 1 / Math.sqrt(Math.max(daysAgo, 0) + 1);
    recencyScore += weight;
    recencyWeightTotal += 1;
  }
  const recencyRatio =
    recencyWeightTotal > 0 ? recencyScore / recencyWeightTotal : 0;
  // Normalize: a perfectly fresh set gives ~1.0, a very stale set gives ~0.1
  const recencyComponent = Math.min(recencyRatio / 0.8, 1.0) * 15;

  // --- Confidence (15%) — average confidence of predictions ---
  const confidences = postSectors.map((ps) => Number(ps.confidence));
  const avgConfidence =
    confidences.length > 0
      ? confidences.reduce((a, b) => a + b, 0) / confidences.length
      : 0;
  const confidenceComponent = avgConfidence * 15;

  // --- Volume (10%) — having at least 20 predictions gives full marks ---
  const volumeComponent = Math.min(totalPredictions / 20, 1.0) * 10;

  const score = Math.round(
    accuracyComponent +
      consistencyComponent +
      recencyComponent +
      confidenceComponent +
      volumeComponent
  );

  return {
    score: Math.min(score, 100),
    accuracyRate: evaluatedPredictions > 0 ? accuracyRate : null,
    totalPredictions,
    correctPredictions,
    avgConfidence,
    label: classifyConfidence(score),
  };
}

/**
 * Calculate aggregate credibility for a blogger across all sectors.
 * Weighted average of per-sector scores, weighted by predictions per sector.
 */
export async function calculateAggregateCredibility(
  bloggerId: string,
  market: string
): Promise<CredibilityScore & { sectorCount: number }> {
  const creds = await prisma.bloggerCredibility.findMany({
    where: { bloggerId, market },
  });

  if (creds.length === 0) {
    return {
      score: 0,
      accuracyRate: null,
      totalPredictions: 0,
      correctPredictions: 0,
      avgConfidence: null,
      label: "低",
      sectorCount: 0,
    };
  }

  const totalPredictions = creds.reduce(
    (sum, c) => sum + c.totalPredictions,
    0
  );
  const correctPredictions = creds.reduce(
    (sum, c) => sum + c.correctPredictions,
    0
  );

  // Weighted average score
  const weightedScore =
    totalPredictions > 0
      ? creds.reduce((sum, c) => sum + Number(c.score) * c.totalPredictions, 0) /
        totalPredictions
      : creds.reduce((sum, c) => sum + Number(c.score), 0) / creds.length;

  const accuracyRate =
    totalPredictions > 0 ? correctPredictions / totalPredictions : null;

  const avgConfidence =
    creds.length > 0
      ? creds.reduce((sum, c) => sum + Number(c.avgConfidence ?? 0), 0) /
        creds.length
      : null;

  return {
    score: Math.round(weightedScore),
    accuracyRate,
    totalPredictions,
    correctPredictions,
    avgConfidence,
    label: classifyConfidence(Math.round(weightedScore)),
    sectorCount: creds.length,
  };
}

/**
 * Persist credibility scores for all blogger-sector pairs in a market.
 * Called by cron after backtesting completes.
 */
export async function recalculateAllCredibility(market: string) {
  // Find all blogger-sector pairs that have predictions
  const pairs = await prisma.postSector.findMany({
    where: {
      sentiment: { not: null },
      post: { blogger: { market } },
    },
    select: {
      post: { select: { bloggerId: true } },
      sectorId: true,
    },
    distinct: ["postId", "sectorId"],
  });

  // Deduplicate blogger-sector pairs
  const seen = new Set<string>();
  const uniquePairs: { bloggerId: string; sectorId: string }[] = [];
  for (const p of pairs) {
    const key = `${p.post.bloggerId}:${p.sectorId}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniquePairs.push({ bloggerId: p.post.bloggerId, sectorId: p.sectorId });
    }
  }

  for (const { bloggerId, sectorId } of uniquePairs) {
    const score = await calculateSectorCredibility(bloggerId, sectorId, market);
    await prisma.bloggerCredibility.upsert({
      where: {
        bloggerId_sectorId: { bloggerId, sectorId },
      },
      create: {
        bloggerId,
        sectorId,
        market,
        score: score.score,
        accuracyRate: score.accuracyRate,
        totalPredictions: score.totalPredictions,
        correctPredictions: score.correctPredictions,
        avgConfidence: score.avgConfidence,
        lastCalculatedAt: new Date(),
      },
      update: {
        score: score.score,
        accuracyRate: score.accuracyRate,
        totalPredictions: score.totalPredictions,
        correctPredictions: score.correctPredictions,
        avgConfidence: score.avgConfidence,
        lastCalculatedAt: new Date(),
      },
    });
  }

  return uniquePairs.length;
}
