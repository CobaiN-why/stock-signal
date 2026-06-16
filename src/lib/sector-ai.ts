import { prisma } from "@/lib/db";
import { getAiFallbackModel, getAiProvider } from "@/lib/ai";
import { normalizeMarket, type Market } from "@/lib/markets";
import type { StockMention } from "@/lib/stock-identifier";
import { fetchStockProfile } from "@/lib/market-data";
import type { StockProfile } from "@/lib/market-data/types";

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

  // Look up company profiles from DB so AI has ground-truth company info
  const stockProfiles = await loadStockProfiles(stockMentions);

  const tickersForPrompt = stockMentions.map((m) => ({
    ticker: m.ticker,
    market: m.market,
    assetType: m.assetType,
    // Include resolved company info if available
    ...(stockProfiles.get(`${m.market}:${m.ticker}`) && {
      companyInfo: stockProfiles.get(`${m.market}:${m.ticker}`),
    }),
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
            "检测到的股票（含已查询的公司信息，优先使用而非猜测）:",
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

    return parseAnalysisResult(answer, cnSectors, stockMentions);
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
- **US stocks**: Use the companyInfo field provided in the input (queried from our database).
  It contains the real company name, industry, and business description.
  Do NOT override or guess -- ALWAYS prefer the provided companyInfo over your own knowledge.
  - Example: NVDA → semiconductors, TSLA → new_energy
  - **If companyInfo is missing for a stock**: you likely do not know this company well enough.
    Set stock_sentiment to "unknown", confidence to 0.45, and evidence to
    "无法确认该公司业务". Never invent company names or industries.
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
- The post is purely asking for information with no implied thesis or opinion
  (e.g., "What caused X to go up?" vs "难道半导体还能跌到哪去?" which implies bullish)
  — Rhetorical questions that convey a view SHOULD still be mapped; the key test is:
  does the author express or imply any directional opinion, even through sarcasm or rhetoric?
- The stock mentioned has an obviously anomalous single-day move (>500%)
  — These are nearly always corporate actions (reverse splits, ticker changes, delisting),
  not real price discovery. 500% threshold intentionally high to avoid false positives.
- The author clearly has no idea what the company does and is just asking others
- If both stock_sentiment and sector_sentiment are "unknown" AND confidence would
  be ≤ 0.5, omit the entry entirely — the AI is admitting it has nothing useful to say

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
  cnSectors: { slug: string; name: string; description: string | null }[],
  mentions: StockMention[]
): UnifiedAnalysis[] {
  const parsed = parseJson(answer);
  if (!Array.isArray(parsed)) return [];

  // Lookup: determine source type for each ticker
  const mentionMap = new Map(
    mentions.map((m) => [`${normalizeMarket(m.market)}:${m.ticker}`, m])
  );

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

    // Source-based confidence adjustment (AI raw confidence as baseline)
    let confidence = rawConfidence;
    if (!item.ticker) {
      // Direct sector/theme mention — high confidence floor
      confidence = Math.max(rawConfidence, 0.75);
    } else {
      const m = mentionMap.get(`${normalizeMarket(item.market)}:${item.ticker}`);
      const isETF = m?.assetType === "ETF";
      const isCN = m?.market === "CN";

      if (isCN && isETF) {
        // CN ETF — DB handles, AI fallback capped at 0.75
        confidence = Math.min(rawConfidence, 0.75);
      } else if (isCN) {
        // A-share individual stock — high confidence floor
        confidence = Math.max(rawConfidence, 0.80);
      } else if (isETF) {
        // US ETF — medium-high confidence floor
        confidence = Math.max(rawConfidence, 0.75);
      } else {
        // US individual stock — medium confidence cap
        confidence = Math.min(rawConfidence, 0.60);
      }
    }

    const stockSentiment = normalizeSentiment(item.stock_sentiment);
    const sectorSentiment = normalizeSentiment(item.sector_sentiment);

    // Only skip truly useless entries (AI admits complete ignorance)
    if (
      stockSentiment === "unknown" &&
      sectorSentiment === "unknown" &&
      rawConfidence < 0.45
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

/**
 * Load company profiles from DB for each mentioned stock.
 * Returns a Map of "market:ticker" → company info string for the AI prompt.
 * This prevents AI hallucinations when it doesn't know a company.
 */
async function loadStockProfiles(
  mentions: StockMention[]
): Promise<Map<string, string>> {
  const profiles = new Map<string, string>();

  if (mentions.length === 0) return profiles;

  // Batch query all mentioned stocks
  const conditions = mentions.map((m) => ({
    market: m.market,
    ticker: m.ticker.toUpperCase(),
  }));

  const stocks = await prisma.stock.findMany({
    where: { OR: conditions },
    select: {
      ticker: true,
      market: true,
      companyName: true,
      profileData: true,
      assetType: true,
      id: true,
    },
  });

  for (const stock of stocks) {
    const key = `${stock.market}:${stock.ticker}`;
    const parts: string[] = [];

    // Company name from DB
    if (stock.companyName) {
      parts.push(stock.companyName);
    }

    // Profile data from DB
    let profile = stock.profileData as Record<string, unknown> | null;

    // If no profile in DB, try to fetch on-the-fly
    if (!profile && stock.market === "US") {
      try {
        const fetched = await fetchStockProfile({
          ticker: stock.ticker,
          market: normalizeMarket(stock.market),
        });
        if (fetched) {
          // Save to DB for future use
          await prisma.stock.update({
            where: { id: stock.id },
            data: {
              profileData: fetched as object,
              profileUpdatedAt: new Date(),
              companyName: stock.companyName || fetched.shortName || fetched.longName,
            },
          }).catch(() => {});
          profile = fetched as unknown as Record<string, unknown>;
        }
      } catch {
        // fire-and-forget, don't block if fetch fails
      }
    }

    if (profile) {
      const industry =
        (profile.industry as string) || (profile.sector as string);
      const desc = profile.description as string;
      const shortDesc = desc?.split(".")[0]; // first sentence only

      // Only include industry if it's meaningful (not "N/A")
      if (industry && industry !== "N/A" && industry !== "n/a") {
        parts.push(`行业: ${industry}`);
      }
      if (shortDesc && shortDesc.length > 10) {
        parts.push(shortDesc.slice(0, 120));
      }
    }

    // If we have nothing useful (empty profile or all N/A),
    // DON'T add companyInfo — let the AI infer from post context
    if (parts.length === 0 && stock.companyName && stock.companyName.length > 1) {
      parts.push(stock.companyName);
    }

    // ETF hint
    if (stock.assetType === "ETF") {
      parts.push("[这是一只ETF]");
    }

    if (parts.length > 0) {
      profiles.set(key, parts.join(" | "));
    }
  }

  return profiles;
}
