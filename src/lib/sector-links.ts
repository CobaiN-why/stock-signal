import { prisma } from "@/lib/db";
import type { SectorMention } from "@/lib/sector-identifier";
import sectorLinks from "@/data/sector-links.json";

interface SectorLinkConfig {
  sourceMarket: string;
  sourceSlug: string;
  targetMarket: string;
  targetSlug: string;
  confidence: number;
  evidence: string;
}

function mentionKey(mention: Pick<SectorMention, "market" | "slug">) {
  return `${mention.market}:${mention.slug}`;
}

function setIfStronger(
  mentions: Map<string, SectorMention>,
  mention: SectorMention
) {
  const existing = mentions.get(mention.sectorId);
  if (!existing || existing.confidence < mention.confidence) {
    mentions.set(mention.sectorId, mention);
  }
}

export async function expandSectorMentionsWithLinks(
  baseMentions: Iterable<SectorMention>
): Promise<SectorMention[]> {
  const mentions = new Map<string, SectorMention>();
  const sourceKeys = new Set<string>();

  for (const mention of baseMentions) {
    setIfStronger(mentions, mention);
    sourceKeys.add(mentionKey(mention));
  }

  const links = (sectorLinks as SectorLinkConfig[]).filter((link) =>
    sourceKeys.has(`${link.sourceMarket}:${link.sourceSlug}`)
  );
  if (links.length === 0) return Array.from(mentions.values());

  const targetSectors = await prisma.sector.findMany({
    where: {
      OR: links.map((link) => ({
        market: link.targetMarket,
        slug: link.targetSlug,
      })),
    },
    select: {
      id: true,
      market: true,
      slug: true,
      name: true,
    },
  });

  for (const link of links) {
    const target = targetSectors.find(
      (sector) =>
        sector.market === link.targetMarket && sector.slug === link.targetSlug
    );
    if (!target) continue;

    setIfStronger(mentions, {
      sectorId: target.id,
      market: target.market === "CN" ? "CN" : "US",
      slug: target.slug,
      name: target.name,
      confidence: link.confidence,
      evidence: link.evidence,
    });
  }

  return Array.from(mentions.values());
}
