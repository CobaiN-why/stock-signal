import type { AiProvider } from "@/lib/ai/types";
import { deepseekProvider } from "@/lib/ai/deepseek";
import { kimiProvider } from "@/lib/ai/kimi";

const providers: Record<string, AiProvider> = {
  kimi: kimiProvider,
  moonshot: kimiProvider,
  deepseek: deepseekProvider,
};

const DEFAULT_AI_PROVIDER = "deepseek";

export function getAiProvider(kind: "sentiment" | "analysis" = "sentiment"): AiProvider | null {
  const raw =
    kind === "sentiment"
      ? process.env.SENTIMENT_AI_PROVIDER ?? process.env.AI_PROVIDER ?? DEFAULT_AI_PROVIDER
      : process.env.ANALYSIS_AI_PROVIDER ?? process.env.AI_PROVIDER ?? DEFAULT_AI_PROVIDER;

  return providers[raw.toLowerCase()] ?? null;
}

export function getAiModel(kind: "sentiment" | "analysis"): string | undefined {
  if (kind === "sentiment") {
    return process.env.SENTIMENT_AI_MODEL;
  }
  return process.env.ANALYSIS_AI_MODEL;
}

export type { AiProvider, ChatCompletionOptions, ChatMessage } from "./types";
