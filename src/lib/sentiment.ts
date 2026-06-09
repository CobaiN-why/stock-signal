import { getAiModel, getAiProvider } from "@/lib/ai";

type Sentiment = "bullish" | "bearish";

const warnedAiErrors = new Set<string>();

// English keywords: matched with word boundaries to avoid substring false positives
// (e.g. "short timeframe" matching "short", "selling" matching "sell")
const BULLISH_EN = [
  "\\bbuy\\b", "\\blong\\b", "\\bbullish\\b", "\\bcalls\\b", "\\bundervalued\\b",
  "\\bmoon\\b", "\\bbreakout\\b", "\\baccumulate\\b", "\\bupside\\b", "\\brally\\b",
  "\\bbottom\\b", "\\bdip buy\\b", "\\bloading\\b", "\\bgoing up\\b", "\\bbuy the dip\\b",
  // gains / multiplier signals — high precision, very unlikely to be bearish
  "\\b\\d+x(?:'d|d|ing)?\\b",          // 10x, 100x, 10x'd, 3xing
  "\\bup \\d[\\d,.%-]*%",               // up 200%, up 83.3%, up 1,000%, up 200-1000%
  "\\b\\d+[,\\d]*% gain",               // 200% gain
  "\\bhundreds? of percent\\b",
  "\\bthousands? of percent\\b",
  "\\bhundred(?:s)?x\\b",
  // monopoly / structural moat language — high precision for this blogger's style
  "\\bsole source\\b",
  "\\bkingmaker\\b",
  "\\bcompelling\\b",
];

const BEARISH_EN = [
  "\\bsell\\b",
  // "short" only as a financial position; avoid "short timeframe/term/period/run/time/while/stint"
  "\\bshort(?!\\s+(?:timeframe|term|period|run|time|while|stint|game|story|squeeze))\\b",
  "\\bbearish\\b", "\\bputs\\b", "\\bovervalued\\b",
  "\\bcrash\\b", "\\bdump\\b", "\\bdownside\\b", "\\bbubble\\b", "\\btrim\\b",
  "\\bgoing down\\b", "\\bshorting\\b",
];

// Chinese keywords: no word boundaries needed (Chinese has no whitespace tokenization)
const BULLISH_CN = [
  "加仓", "看好", "看多", "买入", "上车", "抄底", "起飞", "底部",
  "利好", "做多", "建仓", "景气", "复苏", "突破", "上行", "反转",
  "主线", "机会", "超预期", "高增长", "受益",
];

const BEARISH_CN = [
  "减仓", "看空", "卖出", "下车", "见顶", "泡沫", "崩", "做空",
  "利空", "清仓", "逃顶", "下行", "承压", "走弱", "退潮", "风险",
  "低预期", "不及预期", "杀估值",
];

const bullishEnRegexes = BULLISH_EN.map((p) => new RegExp(p, "i"));
const bearishEnRegexes = BEARISH_EN.map((p) => new RegExp(p, "i"));

export function detectSentimentByRules(text: string): Sentiment | null {
  const lower = text.toLowerCase();
  let bullCount = 0;
  let bearCount = 0;

  for (const re of bullishEnRegexes) {
    if (re.test(text)) bullCount++;
  }
  for (const kw of BULLISH_CN) {
    if (lower.includes(kw)) bullCount++;
  }
  for (const re of bearishEnRegexes) {
    if (re.test(text)) bearCount++;
  }
  for (const kw of BEARISH_CN) {
    if (lower.includes(kw)) bearCount++;
  }

  if (bullCount > bearCount) return "bullish";
  if (bearCount > bullCount) return "bearish";
  return null;
}

export async function detectSentiment(
  text: string,
  target: string
): Promise<Sentiment | null> {
  const rulesResult = detectSentimentByRules(text);
  if (rulesResult) return rulesResult;

  const provider = getAiProvider("sentiment");
  if (!provider) return null;

  try {
    const systemPrompt = `You are a financial market sentiment classifier. Your task is to determine whether the author of a social media post is BULLISH or BEARISH on a specific target.

The target can be a stock ticker, ETF, sector, industry, investment theme, or market direction.

DEFINITIONS:
- BULLISH: The author expects the target to rise, outperform, attract capital, improve fundamentally, or become a promising market direction. This includes: recommending to buy, holding long exposure, setting upside targets, celebrating gains, defending a thesis, calling it a main theme, saying fundamentals are improving, or saying the target benefits from a trend.
- BEARISH: The author expects the target to fall, underperform, lose capital, deteriorate fundamentally, or become a risky market direction. This includes: recommending to sell/short, warning about overvaluation, predicting decline, criticizing fundamentals, saying a theme is crowded/over, or expressing regret about holding.

IMPORTANT RULES:
1. Focus on MARKET SENTIMENT for the target, not general emotion.
2. If the post says a sector/theme has improving demand, policy support, capital inflow, earnings upgrades, or a breakout, classify bullish.
3. If the post says a sector/theme is crowded, deteriorating, overvalued, losing demand, or breaking down, classify bearish.
4. If a stock is mentioned as a positive example inside a target sector, that can be bullish for the sector.
5. If the author mentions the target only in passing or as historical context without expressing a current view, reply unknown.
6. A post may mention multiple tickers or sectors. Classify sentiment ONLY for the requested target.

FEW-SHOT EXAMPLES:

Tweet: "YTD: 3840%. I called out multiple names that 10x'd this year."
Ticker: AXTI
Answer: bullish
Reason: Author is celebrating massive gains and taking credit for the call — clearly still bullish.

Tweet: "institutions bear posted my thesis, retail paper handed, then the stock went up thousands of percent"
Ticker: AXTI
Answer: bullish
Reason: Author is defending the stock against bearish institutions, implying it was right to hold.

Tweet: "This is going to zero. Complete scam, no revenue, all hype."
Ticker: XYZ
Answer: bearish

Tweet: "I'm shorting this garbage. Already up 40% on my puts."
Ticker: ABC
Answer: bearish

Tweet: "Nice rally today, but I think $50 is the top. Trimming my position here."
Ticker: DEF
Answer: bearish

Tweet: "I love $SOI and $AXTI as monopoly plays. $HIMX might get displaced by $TSM's Visera subsidiary."
Ticker: TSM
Answer: unknown
Reason: The author is bullish on SOI and AXTI. TSM is only mentioned as a parent company whose subsidiary might displace a competitor — no direct opinion on TSM stock itself.

Tweet: "$QQQ was down today. In other news I had pizza for lunch."
Ticker: QQQ
Answer: unknown

Tweet: "HBM demand is still underestimated. Advanced packaging capacity is the bottleneck and the whole semiconductor chain should keep seeing upgrades."
Target: 半导体
Answer: bullish

Tweet: "AI capex is peaking, GPU orders are getting pulled forward, and semis look crowded here."
Target: 半导体
Answer: bearish

Tweet: "政策继续加码，新能源车渗透率还有空间，电池链基本面在修复。"
Target: 新能源
Answer: bullish

Tweet: "光伏价格战还没结束，库存压力很大，行业盈利继续下修。"
Target: 光伏
Answer: bearish

Tweet: "Software bros happy about a 10-15% recovery after getting wiped 25-60%. Meanwhile AI names from $SNDK to $AAOI are casually up 200-1000%."
Ticker: AAOI
Answer: bullish
Reason: The author is contrasting losers (software stocks) with winners ($AAOI up 200-1000%). $AAOI is explicitly in the winning group — clearly bullish.

Tweet: "Sold my $NVDA position last month. Rotating into $AXTI and $AAOI which I think have more room to run."
Ticker: NVDA
Answer: bearish
Reason: Author sold NVDA to buy other stocks — expressing a negative/exit view on NVDA specifically.

Tweet: "Back at $44 EUR, European media said $SOI was an 'overvalued stock' and 'purely speculative'. Traditions analysts had no clue. $SOI is now up 342% since."
Ticker: SOI
Answer: bullish
Reason: The author is QUOTING critics to prove them wrong. The author's own view is clearly bullish — $SOI is up 342% since their call.

Tweet: "A publication called my $RPI idea 'mass stupidity' and said shares would 'come crashing back to reality'. Earnings came out? Blew away expectations."
Ticker: RPI
Answer: bullish
Reason: Author is defending their bullish thesis by showing critics were wrong. The quoted bearish language belongs to critics, not the author.

Reply with exactly one word: bullish, bearish, or unknown. Nothing else.`;

    const escapedTarget = target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const highlighted = text
      .slice(0, 800)
      .replace(new RegExp(`\\$?${escapedTarget}`, "gi"), `★${target}★`);

    const answer = (
      await provider.chat(
        [
          {
            role: "system",
            content: systemPrompt,
          },
          {
            role: "user",
            content: `Target: ${target} (marked as ★${target}★ when present)\n\nPost:\n"${highlighted}"`,
          },
        ],
        {
          model: getAiModel("sentiment"),
          temperature: 0,
          maxTokens: 10,
        }
      )
    )
      .trim()
      .toLowerCase();

    if (answer === "bullish") return "bullish";
    if (answer === "bearish") return "bearish";
    return null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const key = message.slice(0, 120);
    if (!warnedAiErrors.has(key)) {
      warnedAiErrors.add(key);
      console.warn(`Sentiment AI fallback failed: ${message}`);
    }
    return null;
  }
}
