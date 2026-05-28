const KIMI_API_URL = "https://api.moonshot.cn/v1/chat/completions";

type Sentiment = "bullish" | "bearish";

const BULLISH_KEYWORDS = [
  "buy", "long", "bullish", "calls", "undervalued", "moon", "breakout",
  "accumulate", "upside", "rally", "bottom", "dip buy", "loading",
  "加仓", "看好", "看多", "买入", "上车", "抄底", "起飞", "底部",
  "利好", "做多", "建仓",
];

const BEARISH_KEYWORDS = [
  "sell", "short", "bearish", "puts", "overvalued", "crash", "dump",
  "downside", "top", "bubble", "exit", "trim",
  "减仓", "看空", "卖出", "下车", "见顶", "泡沫", "崩", "做空",
  "利空", "清仓", "逃顶",
];

export function detectSentimentByRules(text: string): Sentiment | null {
  const lower = text.toLowerCase();
  let bullCount = 0;
  let bearCount = 0;

  for (const kw of BULLISH_KEYWORDS) {
    if (lower.includes(kw)) bullCount++;
  }
  for (const kw of BEARISH_KEYWORDS) {
    if (lower.includes(kw)) bearCount++;
  }

  if (bullCount > bearCount) return "bullish";
  if (bearCount > bullCount) return "bearish";
  return null;
}

export async function detectSentiment(
  text: string,
  ticker: string
): Promise<Sentiment | null> {
  const rulesResult = detectSentimentByRules(text);
  if (rulesResult) return rulesResult;

  const apiKey = process.env.KIMI_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch(KIMI_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "moonshot-v1-8k",
        messages: [
          {
            role: "system",
            content:
              "You classify stock-related tweets. Reply with exactly one word: bullish, bearish, or unknown. Nothing else.",
          },
          {
            role: "user",
            content: `Tweet about $${ticker}:\n"${text.slice(0, 500)}"`,
          },
        ],
        temperature: 0,
        max_tokens: 10,
      }),
    });

    if (!res.ok) return null;

    const data = await res.json();
    const answer = (data.choices?.[0]?.message?.content ?? "")
      .trim()
      .toLowerCase();

    if (answer === "bullish") return "bullish";
    if (answer === "bearish") return "bearish";
    return null;
  } catch {
    return null;
  }
}
