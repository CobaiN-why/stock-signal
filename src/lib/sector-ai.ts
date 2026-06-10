import { prisma } from "@/lib/db";
import { getAiFallbackModel, getAiProvider } from "@/lib/ai";
import { normalizeMarket, type Market } from "@/lib/markets";
import type { StockMention } from "@/lib/stock-identifier";

export type Sentiment = "bullish" | "bearish";

export interface UnifiedAnalysis {
  /** Stock ticker if this analysis is for a specific stock */
  ticker?: string;
  /** Market of the stock */
  market?: Market;
  /** AI-identified company name / business description */
  company?: string;
  /** Per-stock sentiment (for PostStock.sentiment) */
  stockSentiment?: Sentiment | null;
  /** Target CN sector slug */
  sectorSlug: string;
  /** Target sector market (always "CN" since we map to A-share sectors) */
  sectorMarket: string;
  /** Sector display name */
  sectorName: string;
  /** Per-sector sentiment (for PostSector.sentiment) */
  sectorSentiment: Sentiment | null;
  /** Confidence 0-1 */
  confidence: number;
  /** Short evidence phrase */
  evidence: string;
}

interface AiAnalysisItem {
  ticker?: string;
  market?: string;
  company?: string;
  stock_sentiment?: string;
  sector_slug?: string;
  sector_sentiment?: string;
  confidence?: number;
  evidence?: string;
}

const warnedAiErrors = new Set<string>();

/**
 * Unified AI analysis: identifies sectors, maps stocks to CN sectors,
 * and determines sentiment — all in a single API call.
 *
 * Replaces: identifySectorsAcrossMarkets + expandSectorMentionsWithLinks
 *           + per-sector detectSentiment calls
 */
export async function analyzeSectorsAndSentiment(
  text: string,
  stockMentions: StockMention[]
): Promise<UnifiedAnalysis[]> {
  const provider = getAiProvider("analysis");
  if (!provider) return [];

  // Load CN sector candidates for the AI to map to (only sectors with ETFs)
  const cnSectors = await prisma.sector.findMany({
    where: { market: "CN", etfs: { some: {} } },
    select: {
      slug: true,
      name: true,
      description: true,
    },
    orderBy: { name: "asc" },
  });

  if (cnSectors.length === 0) return [];

  const tickersForPrompt = stockMentions.map((m) => ({
    ticker: m.ticker,
    market: m.market,
    assetType: m.assetType,
  }));

  try {
    const answer = await provider.chat(
      [
        {
          role: "system",
          content: buildSystemPrompt(),
        },
        {
          role: "user",
          content: [
            "A股板块候选:",
            JSON.stringify(cnSectors),
            "",
            "检测到的股票:",
            JSON.stringify(tickersForPrompt),
            "",
            "帖子:",
            text.slice(0, 2000),
          ].join("\n"),
        },
      ],
      {
        model: getAiFallbackModel(),
        temperature: 0,
        maxTokens: 600,
      }
    );

    return parseAnalysisResult(answer, cnSectors);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const key = message.slice(0, 120);
    if (!warnedAiErrors.has(key)) {
      warnedAiErrors.add(key);
      console.warn(`Sector AI analysis failed: ${message}`);
    }
    return [];
  }
}

function buildSystemPrompt(): string {
  return `You analyze financial social media posts. Your task: identify sectors/themes, map stocks to A-share sectors, and determine sentiment — all at once.

## INPUT
You receive: (1) a post (Chinese/English/mixed), (2) stock tickers detected by regex, (3) a list of A-share sector candidates.

## OUTPUT RULES

### 1. Direct sector mentions
If the post discusses a sector/theme directly (e.g. "半导体爆发", "新能源看好", "chip demand strong"), output it even without a ticker. Map it to the best-matching A-share sector candidate.

### 2. Stock → sector mapping
For each detected stock:
- **US stocks**: Identify the company's core business → map to the most relevant A-share sector.
  - Example: NVDA → semiconductors, TSLA → new_energy
- **CN stocks (6-digit codes starting with 00/30/60/68)**: Identify the company → map to its A-share sector.
- **CN ETFs (6-digit codes starting with 51/15/58)**: Map directly. e.g. 512760 (芯片ETF) → semiconductors
- **assetType "ETF"** means it's already an ETF — map it directly to its sector.
- If a stock has no clear A-share sector match, omit it.

### 3. Sentiment
Determine BULLISH vs BEARISH for each stock AND each sector. They CAN differ — a stock may be bullish while its sector is bearish or vice versa.

**DEFINITIONS:**
- BULLISH: expects rise, outperform, attract capital, improve fundamentally. Includes: recommending buy/long, celebrating gains, defending a thesis, calling it a main theme, saying fundamentals are improving.
- BEARISH: expects fall, underperform, lose capital, deteriorate. Includes: recommending sell/short, warning about overvaluation/peak, criticizing fundamentals, saying a theme is crowded/over.
- UNKNOWN: target is relevant but author gives no clear directional view. Also use for:
  - Completed historical trades without a current forward-looking view ("上个月卖了", "Sold last month", "之前清仓了")
  - Passing mentions without opinion
  - Quoted criticism from OTHERS is NOT the author's view — infer the author's own stance from context

**CRITICAL SENTIMENT RULES:**
- "Sold X last month, rotating to Y" → X is unknown (historical), Y may be bullish
- "X is going to zero, complete scam" → bearish on X
- "I'm shorting this, already up 40% on puts" → bearish
- "Nice rally but I think \$50 is the top, trimming" → bearish
- "A publication called my idea 'mass stupidity'... earnings blew away expectations" → bullish (author is DEFENDING against critics)
- "European media said overvalued... now up 342% since" → bullish (quoting critics to PROVE THEM WRONG)
- "Institutions bearish, retail paper handed, then stock went up thousands of percent" → bullish (author vindicated)
- "YTD 3840%, I called multiple names that 10x'd" → bullish (celebrating gains)
- "Software bros happy about 10-15% recovery, AI names casually up 200-1000%" → AI names are bullish (contrasting winners vs losers)
- "HBM demand underestimated, semis should keep seeing upgrades" → bullish
- "AI capex peaking, GPU orders pulled forward, semis look crowded" → bearish
- "政策继续加码，新能源车渗透率还有空间，电池链基本面在修复" → bullish
- "光伏价格战还没结束，库存压力很大，行业盈利继续下修" → bearish

### 4. When NOT to map
Do NOT output a sector if:
- The post is purely a question with no analysis or opinion (e.g., "What caused X to go up 3660%?" — no thesis)
- The stock mentioned has an obviously anomalous single-day move (>500%) — these are corporate actions (reverse splits, ticker changes), not real trading gains
- The stock is only mentioned in passing with no context about its business or sector
- The author clearly has no idea what the company does
- If both stock_sentiment and sector_sentiment are "unknown" AND confidence would be below 0.5, omit the entry entirely

### 5. Confidence
- 0.85-0.95: explicit sector/stock discussion with clear sentiment
- 0.65-0.85: clear discussion but indirect mapping or mixed signals
- 0.45-0.65: indirect mention, cross-market analogy, or weak signal
- Do NOT use confidence above 0.95 or below 0.45. Default to 0.55 if very uncertain.

### 6. Output format
Return STRICT JSON array. Each item:
{
  "ticker": "NVDA",           // stock ticker (OMIT for direct sector mentions)
  "market": "US",             // stock market (OMIT for direct sector mentions)
  "company": "NVIDIA",        // company name (OMIT for direct sector mentions)
  "stock_sentiment": "bullish", // per-stock sentiment: bullish/bearish/unknown
  "sector_slug": "semiconductors", // A-share sector slug from candidates
  "sector_sentiment": "bullish",   // per-sector sentiment: bullish/bearish/unknown
  "confidence": 0.90,
  "evidence": "NVIDIA是AI芯片龙头，映射到A股半导体板块"
}

For direct sector mentions (no ticker), omit ticker/market/company/stock_sentiment:
{
  "sector_slug": "semiconductors",
  "sector_sentiment": "bullish",
  "confidence": 0.85,
  "evidence": "帖子整体看好半导体板块"
}

- Return at most 6 items.
- sector_slug MUST match an "slug" from the A-share sector candidates list.
- Only return items where the sector or stock is clearly discussed.
- Return [] if nothing fits.`;
}

function parseAnalysisResult(
  answer: string,
  cnSectors: { slug: string; name: string; description: string | null }[]
): UnifiedAnalysis[] {
  const parsed = parseJson(answer);
  if (!Array.isArray(parsed)) return [];

  const sectorByName = new Map(cnSectors.map((s) => [s.slug, s]));
  const results: UnifiedAnalysis[] = [];
  const seen = new Set<string>();

  for (const item of parsed as AiAnalysisItem[]) {
    const sectorSlug = item.sector_slug?.trim();
    if (!sectorSlug) continue;

    const sector = sectorByName.get(sectorSlug);
    if (!sector) continue;

    // Dedup: one result per (ticker + sector) or per sector for direct mentions
    const key = item.ticker
      ? `${normalizeMarket(item.market)}:${item.ticker}:${sectorSlug}`
      : `sector:${sectorSlug}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const rawConfidence =
      typeof item.confidence === "number" && Number.isFinite(item.confidence)
        ? item.confidence
        : 0.55;
    const confidence = Math.min(0.95, Math.max(0.45, rawConfidence));

    const stockSentiment = normalizeSentiment(item.stock_sentiment);
    const sectorSentiment = normalizeSentiment(item.sector_sentiment);

    // Skip entries where both sentiments are unknown AND confidence is low
    // (pure questions, passing mentions with no analytical value)
    if (
      stockSentiment === "unknown" &&
      sectorSentiment === "unknown" &&
      rawConfidence < 0.55
    ) {
      continue;
    }

    results.push({
      ticker: item.ticker?.trim() || undefined,
      market: item.market ? normalizeMarket(item.market) : undefined,
      company: item.company?.trim() || undefined,
      stockSentiment: stockSentiment === "unknown" ? null : stockSentiment,
      sectorSlug,
      sectorMarket: "CN",
      sectorName: sector.name,
      sectorSentiment: sectorSentiment === "unknown" ? null : sectorSentiment,
      confidence,
      evidence: item.evidence?.trim()
        ? `AI分析: ${item.evidence.slice(0, 100)}`
        : "AI综合分析",
    });
  }

  return results;
}

function parseJson(answer: string): unknown {
  const trimmed = answer.trim();
  const jsonText = trimmed.startsWith("[") ? trimmed : trimmed.match(/\[[\s\S]*\]/)?.[0] ?? "";
  if (!jsonText) return null;
  try {
    return JSON.parse(jsonText);
  } catch {
    return null;
  }
}

function normalizeSentiment(
  value: string | null | undefined
): Sentiment | "unknown" {
  const v = String(value ?? "unknown").trim().toLowerCase();
  if (v === "bullish" || v === "看多") return "bullish";
  if (v === "bearish" || v === "看空") return "bearish";
  return "unknown";
}
