import { prisma } from "@/lib/db";
import { getAiFallbackModel, getAiProvider } from "@/lib/ai";
import { DEFAULT_MARKET, normalizeMarket, type Market } from "@/lib/markets";

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

type SectorCandidate = {
  id: string;
  market: string;
  slug: string;
  name: string;
  description: string | null;
  keywords: { keyword: string }[];
  etfs: { ticker: string; name: string; rationale: string; rank: number }[];
};

type AiSectorMatch = {
  market?: string;
  slug?: string;
  view?: string;
  sentiment?: string;
  confidence?: number;
  evidence?: string;
};

const warnedAiErrors = new Set<string>();

export async function identifySectors(
  text: string,
  marketValue: string | null | undefined = DEFAULT_MARKET
): Promise<SectorMention[]> {
  const market = normalizeMarket(marketValue);
  return identifySectorsByAi(text, [market]);
}

export async function identifySectorsAcrossMarkets(
  text: string
): Promise<SectorMention[]> {
  return identifySectorsByAi(text, ["US"]);
}

async function identifySectorsByAi(
  text: string,
  markets: Market[]
): Promise<SectorMention[]> {
  const provider = getAiProvider("analysis");
  if (!provider) return [];

  const candidates = await prisma.sector.findMany({
    where: {
      market: { in: markets },
      etfs: { some: {} },
    },
    include: {
      keywords: true,
      etfs: {
        orderBy: { rank: "asc" },
        take: 3,
      },
    },
    orderBy: [{ market: "asc" }, { name: "asc" }],
  });
  if (candidates.length === 0) return [];

  try {
    const answer = await provider.chat(
      [
        {
          role: "system",
          content: `You classify social media posts into ETF-style investment categories and the author's view on each category.

Rules:
- Choose only from the provided ETF category candidates.
- Prefer the ETF category that best captures the post's investment theme, industry chain, or macro trade.
- The category may be US-listed, but it will be used as a reference for China A-share ETF/sector recommendations later.
- The post can be Chinese, English, or mixed.
- Decide the author's view for the category:
  - "bullish": expects the category/theme to rise, outperform, improve, attract capital, or benefit from a trend.
  - "bearish": expects the category/theme to fall, underperform, deteriorate, get crowded, or face risk.
  - "unknown": the category is relevant but the author gives no clear current directional view.
  - "unrelated": the candidate is not actually related to the post.
- Completed historical trades are unknown unless the author also gives a current forward-looking view.
- Quoted criticism from others is not the author's view; infer the author's own stance from context.
- Do not invent categories. Use lower confidence for indirect or cross-market analogies.
- Return at most 3 related categories.
- Return strict JSON only: [{"market":"US","slug":"semiconductors","view":"bullish","confidence":0.62,"evidence":"short phrase"}].
- Omit unrelated categories. Return [] if no candidate fits.`,
        },
        {
          role: "user",
          content: [
            "ETF category candidates:",
            JSON.stringify(formatSectorCandidates(candidates)),
            "",
            "Post:",
            text.slice(0, 1800),
          ].join("\n"),
        },
      ],
      {
        model: getAiFallbackModel(),
        temperature: 0,
        maxTokens: 300,
      }
    );

    return toSectorMentions(answer, candidates);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const key = message.slice(0, 120);
    if (!warnedAiErrors.has(key)) {
      warnedAiErrors.add(key);
      console.warn(`Sector AI fallback failed: ${message}`);
    }
    return [];
  }
}

function formatSectorCandidates(candidates: SectorCandidate[]) {
  return candidates.map((sector) => ({
    market: normalizeMarket(sector.market),
    slug: sector.slug,
    name: sector.name,
    description: sector.description,
    keywords: sector.keywords.map((kw) => kw.keyword).slice(0, 10),
    etfs: sector.etfs.map((etf) => ({
      ticker: etf.ticker,
      name: etf.name,
      rationale: etf.rationale,
    })),
  }));
}

function toSectorMentions(
  answer: string,
  candidates: SectorCandidate[]
): SectorMention[] {
  const parsed = parseAiSectorMatches(answer);
  if (!Array.isArray(parsed)) return [];

  const byKey = new Map(
    candidates.map((sector) => [
      `${normalizeMarket(sector.market)}:${sector.slug}`,
      sector,
    ])
  );
  const matches = new Map<string, SectorMention>();

  for (const item of parsed) {
    const market = normalizeMarket(item.market);
    if (!item.slug) continue;
    const sector = byKey.get(`${market}:${item.slug}`);
    if (!sector || matches.has(sector.id)) continue;
    const sentiment = normalizeAiView(item.view ?? item.sentiment);
    if (sentiment === "unrelated") continue;

    const rawConfidence =
      typeof item.confidence === "number" && Number.isFinite(item.confidence)
        ? item.confidence
        : 0.5;
    const confidence = Math.min(0.85, Math.max(0.35, rawConfidence));
    matches.set(sector.id, {
      sectorId: sector.id,
      market: normalizeMarket(sector.market),
      slug: sector.slug,
      name: sector.name,
      evidence: item.evidence
        ? `ETF类别AI: ${item.evidence.slice(0, 80)}`
        : "ETF类别AI推断",
      confidence,
      sentiment: sentiment === "unknown" ? null : sentiment,
    });
  }

  return Array.from(matches.values());
}

function parseAiSectorMatches(answer: string): AiSectorMatch[] | null {
  const trimmed = answer.trim();
  const jsonText =
    trimmed.startsWith("[")
      ? trimmed
      : trimmed.match(/\[[\s\S]*\]/)?.[0] ?? "";
  if (!jsonText) return null;

  try {
    return JSON.parse(jsonText) as AiSectorMatch[];
  } catch {
    return null;
  }
}

function normalizeAiView(
  value: string | null | undefined
): SectorSentiment | "unknown" | "unrelated" {
  const normalized = String(value ?? "unknown").trim().toLowerCase();
  if (normalized === "bullish" || normalized === "看多") return "bullish";
  if (normalized === "bearish" || normalized === "看空") return "bearish";
  if (normalized === "unrelated" || normalized === "irrelevant" || normalized === "无关") {
    return "unrelated";
  }
  return "unknown";
}
