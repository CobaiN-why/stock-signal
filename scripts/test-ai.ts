import {
  getAiFallbackModel,
  getAiModel,
  getAiProvider,
} from "../src/lib/ai/index.js";
import { detectSentiment } from "../src/lib/sentiment.js";
import { analyzeSectorsAndSentiment } from "../src/lib/sector-ai.js";
import { prisma } from "../src/lib/db.js";

async function main() {
  const sentimentProvider = getAiProvider("sentiment");
  const analysisProvider = getAiProvider("analysis");
  const hasDeepSeekKey = Boolean(process.env.DEEPSEEK_API_KEY);

  console.log("AI config:");
  console.table({
    sentimentProvider: sentimentProvider?.name ?? "(none)",
    sentimentModel: getAiModel("sentiment") ?? sentimentProvider?.defaultModel ?? "(none)",
    analysisProvider: analysisProvider?.name ?? "(none)",
    analysisModel: getAiModel("analysis") ?? analysisProvider?.defaultModel ?? "(none)",
    aiFallbackModel: getAiFallbackModel(),
    deepseekKeyPresent: hasDeepSeekKey,
  });

  if (!sentimentProvider) {
    throw new Error("No sentiment AI provider configured");
  }

  const pong = await sentimentProvider.chat(
    [
      {
        role: "user",
        content: "Reply with exactly one word: pong",
      },
    ],
    {
      model: getAiFallbackModel(),
      temperature: 0,
      maxTokens: 10,
    }
  );
  console.log("Direct chat response:", pong.trim());

  const post =
    "HBM demand remains stronger than expected and advanced packaging capacity is still the bottleneck.";
  const sentiment = await detectSentiment(post, "半导体");
  console.log("Sentiment fallback result:", sentiment ?? "unknown");

  const sectors = await analyzeSectorsAndSentiment(
    "AI capex keeps pushing HBM, CoWoS, and high-bandwidth memory supply chains into a new bottleneck cycle.",
    []
  );
  console.log(
    "Sector analysis result:",
    sectors.map((r) => ({
      ticker: r.ticker,
      company: r.company,
      sectorSlug: r.sectorSlug,
      sectorName: r.sectorName,
      stockSentiment: r.stockSentiment,
      sectorSentiment: r.sectorSentiment,
      confidence: r.confidence,
      evidence: r.evidence,
    }))
  );
}

main()
  .catch((err) => {
    console.error("AI test failed:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
