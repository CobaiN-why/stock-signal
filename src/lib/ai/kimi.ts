import type { AiProvider, ChatMessage, ChatCompletionOptions } from "@/lib/ai/types";

const KIMI_API_URL = "https://api.moonshot.cn/v1/chat/completions";

export const kimiProvider: AiProvider = {
  name: "kimi",
  defaultModel: "moonshot-v1-8k",

  async chat(
    messages: ChatMessage[],
    options: ChatCompletionOptions = {}
  ): Promise<string> {
    const apiKey = process.env.KIMI_API_KEY;
    if (!apiKey) throw new Error("KIMI_API_KEY not set");

    const res = await fetch(KIMI_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: options.model ?? kimiProvider.defaultModel,
        messages,
        temperature: options.temperature ?? 0,
        max_tokens: options.maxTokens ?? 1024,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Kimi API error: ${res.status} ${errText}`);
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? "";
  },
};
