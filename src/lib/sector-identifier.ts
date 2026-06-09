import { normalizeMarket, type Market } from "@/lib/markets";

export type SectorSentiment = "bullish" | "bearish";

export interface SectorMention {
  sectorId: string;
  market: Market;
  slug: string;
  name: string;
  evidence: string;
  confidence: number;
  sentimentTarget?: string;
  sentiment?: SectorSentiment | null;
}

/**
 * @deprecated Use analyzeSectorsAndSentiment() from "@/lib/sector-ai" instead.
 * This function is kept for backward compatibility in backfill scripts.
 */
export async function identifySectorsAcrossMarkets(
  _text: string
): Promise<SectorMention[]> {
  // The old AI ETF category approach has been replaced by analyzeSectorsAndSentiment().
  // This stub returns [] so callers don't break at the type level.
  // Callers should migrate to the new unified pipeline.
  console.warn(
    "identifySectorsAcrossMarkets is deprecated. Use analyzeSectorsAndSentiment() from sector-ai.ts"
  );
  return [];
}
