import { prisma } from "@/lib/db";
import { getAiFallbackModel, getAiProvider } from "@/lib/ai";
import { ALL_MARKETS, DEFAULT_MARKET, normalizeMarket, type Market } from "@/lib/markets";

export interface SectorMention {
  sectorId: string;
  market: Market;
  slug: string;
  name: string;
  evidence: string;
  confidence: number;
}

type SectorCandidate = {
  id: string;
  market: string;
  slug: string;
  name: string;
  description: string | null;
  keywords: { keyword: string }[];
};

type AiSectorMatch = {
  market?: string;
  slug?: string;
  confidence?: number;
  evidence?: string;
};

const warnedAiErrors = new Set<string>();

export async function identifySectors(
  text: string,
  marketValue: string | null | undefined = DEFAULT_MARKET
): Promise<SectorMention[]> {
  const market = normalizeMarket(marketValue);
  const ruleMatches = await identifySectorsByRules(text, market);
  if (ruleMatches.length > 0) return ruleMatches;

  return identifySectorsByAi(text, [market]);
}

async function identifySectorsByRules(
  text: string,
  market: Market
): Promise<SectorMention[]> {
  const lowerText = text.toLowerCase();
  const matches = new Map<string, SectorMention>();

  const keywords = await prisma.sectorKeyword.findMany({
    where: { sector: { market } },
    include: { sector: true },
  });

  for (const item of keywords) {
    const keyword = item.keyword.toLowerCase();
    if (!keyword || !lowerText.includes(keyword)) continue;
    if (!matches.has(item.sectorId)) {
      matches.set(item.sectorId, {
        sectorId: item.sectorId,
        market,
        slug: item.sector.slug,
        name: item.sector.name,
        evidence: item.keyword,
        confidence: 1,
      });
    }
  }

  return Array.from(matches.values());
}

export async function identifySectorsAcrossMarkets(
  text: string
): Promise<SectorMention[]> {
  const matches = await Promise.all(
    ALL_MARKETS.map((market) => identifySectorsByRules(text, market))
  );
  const sectors = new Map<string, SectorMention>();

  for (const sector of matches.flat()) {
    if (!sectors.has(sector.sectorId)) sectors.set(sector.sectorId, sector);
  }

  if (sectors.size > 0) return Array.from(sectors.values());

  return identifySectorsByAi(text, ALL_MARKETS);
}

async function identifySectorsByAi(
  text: string,
  markets: Market[]
): Promise<SectorMention[]> {
  const provider = getAiProvider("analysis");
  if (!provider) return [];

  const candidates = await prisma.sector.findMany({
    where: { market: { in: markets } },
    include: { keywords: true },
    orderBy: [{ market: "asc" }, { name: "asc" }],
  });
  if (candidates.length === 0) return [];

  try {
    const answer = await provider.chat(
      [
        {
          role: "system",
          content: `You classify social media posts into investment sectors.

Rules:
- Match only sectors that are clearly discussed as an investment topic, market direction, industry chain, ETF theme, or macro trade.
- The post can be Chinese, English, or mixed.
- Do not invent sectors. Choose only from the provided candidates.
- If the link is indirect or weak, use lower confidence.
- Return strict JSON only: [{"market":"CN","slug":"semiconductors","confidence":0.55,"evidence":"short phrase"}].
- Return [] if no candidate fits.`,
        },
        {
          role: "user",
          content: [
            "Candidates:",
            JSON.stringify(formatSectorCandidates(candidates)),
            "",
            "Post:",
            text.slice(0, 1200),
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
    keywords: sector.keywords.map((kw) => kw.keyword),
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

    const rawConfidence =
      typeof item.confidence === "number" && Number.isFinite(item.confidence)
        ? item.confidence
        : 0.5;
    const confidence = Math.min(0.65, Math.max(0.35, rawConfidence));
    matches.set(sector.id, {
      sectorId: sector.id,
      market: normalizeMarket(sector.market),
      slug: sector.slug,
      name: sector.name,
      evidence: item.evidence ? `AI: ${item.evidence.slice(0, 80)}` : "AI 推断",
      confidence,
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
