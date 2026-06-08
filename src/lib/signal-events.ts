import { prisma } from "@/lib/db";
import { formatInstrumentLabel, normalizeMarket, type Market } from "@/lib/markets";

interface BaseEvent {
  market?: string | null;
  stockId?: string | null;
  sectorId?: string | null;
  sourceUrl?: string | null;
  metadata?: object;
}

async function recordSignalEvent(
  eventType: string,
  title: string,
  body: string,
  opts: BaseEvent & { severity?: string } = {}
) {
  return prisma.signalEvent.create({
    data: {
      eventType,
      severity: opts.severity ?? "info",
      market: normalizeMarket(opts.market).toString(),
      title,
      body,
      sourceUrl: opts.sourceUrl ?? null,
      stockId: opts.stockId ?? null,
      sectorId: opts.sectorId ?? null,
      metadata: opts.metadata ?? undefined,
    },
  });
}

export async function recordNewStockMention(input: {
  ticker: string;
  market: Market;
  stockId: string;
  blogger: string;
  content: string;
  postUrl: string;
}) {
  return recordSignalEvent(
    "new_stock",
    `新标的入库: ${formatInstrumentLabel(input.ticker, input.market)}`,
    `@${input.blogger}: ${input.content.slice(0, 240)}`,
    {
      market: input.market,
      stockId: input.stockId,
      sourceUrl: input.postUrl,
      metadata: { blogger: input.blogger, ticker: input.ticker },
    }
  );
}

export async function recordSentimentFlip(input: {
  ticker: string;
  market: Market;
  stockId: string;
  blogger: string;
  previousSentiment: string;
  currentSentiment: string;
  content: string;
  postUrl: string;
}) {
  return recordSignalEvent(
    "sentiment_flip",
    `观点反转: ${formatInstrumentLabel(input.ticker, input.market)}`,
    `@${input.blogger}: ${input.previousSentiment} -> ${input.currentSentiment}\n${input.content.slice(0, 240)}`,
    {
      severity: "warning",
      market: input.market,
      stockId: input.stockId,
      sourceUrl: input.postUrl,
      metadata: {
        blogger: input.blogger,
        previousSentiment: input.previousSentiment,
        currentSentiment: input.currentSentiment,
      },
    }
  );
}

export async function recordDivergence(input: {
  ticker: string;
  market: Market;
  stockId: string;
  bullishBloggers: string[];
  bearishBloggers: string[];
  content: string;
  postUrl: string;
}) {
  return recordSignalEvent(
    "divergence",
    `博主观点分歧: ${formatInstrumentLabel(input.ticker, input.market)}`,
    `看多: ${input.bullishBloggers.join(", ")}\n看空: ${input.bearishBloggers.join(", ")}\n${input.content.slice(0, 240)}`,
    {
      severity: "warning",
      market: input.market,
      stockId: input.stockId,
      sourceUrl: input.postUrl,
      metadata: {
        bullishBloggers: input.bullishBloggers,
        bearishBloggers: input.bearishBloggers,
      },
    }
  );
}

export async function recordSectorMention(input: {
  sectorId: string;
  sectorName: string;
  market: Market;
  blogger: string;
  content: string;
  postUrl: string;
  confidence?: number;
  evidence?: string;
  sentiment?: string | null;
}) {
  const strength =
    input.confidence !== undefined && input.confidence < 0.7
      ? "弱关联"
      : "直接提及";
  const sentimentText =
    input.sentiment === "bullish"
      ? "看多"
      : input.sentiment === "bearish"
        ? "看空"
        : "倾向未知";

  return recordSignalEvent(
    "sector_mention",
    `板块提及: ${input.sectorName} (${strength})`,
    `@${input.blogger}: ${sentimentText}${input.evidence ? ` / ${input.evidence}` : ""}\n${input.content.slice(0, 240)}`,
    {
      market: input.market,
      sectorId: input.sectorId,
      sourceUrl: input.postUrl,
      metadata: {
        blogger: input.blogger,
        confidence: input.confidence,
        evidence: input.evidence,
        sentiment: input.sentiment,
      },
    }
  );
}

export async function recordIngestAlert(message: string) {
  return recordSignalEvent("ingest_alert", "抓取任务异常", message, {
    severity: "error",
  });
}
