/**
 * Individual stock sentiment detection via rules + AI fallback.
 *
 * For sector-level sentiment, see analyzeSectorsAndSentiment() in sector-ai.ts
 * which handles sector sentiment as part of the unified AI analysis pipeline.
 */
import { getAiFallbackModel, getAiProvider } from "@/lib/ai";

type Sentiment = "bullish" | "bearish";

const warnedAiErrors = new Set<string>();
const TARGET_WINDOW_CHARS = 180;

// English keywords: matched with word boundaries to avoid substring false positives
// (e.g. "short timeframe" matching "short", "selling" matching "sell")
const BULLISH_EN = [
  "\\bbuy\\b", "\\blong\\b", "\\bbullish\\b", "\\bcalls\\b", "\\bundervalued\\b",
  "\\bmoon\\b", "\\bbreakout\\b", "\\baccumulate\\b", "\\bupside\\b", "\\brally\\b",
  "\\bbottom\\b", "\\bdip buy\\b", "\\bloading\\b", "\\bgoing up\\b", "\\bbuy the dip\\b",
  "\\boutperform\\b", "\\bbeat(s|ing)?\\b", "\\bupgrade(s|d)?\\b", "\\bre-rate\\b",
  "\\bstrong demand\\b", "\\bdemand acceleration\\b", "\\bcapacity constrained\\b",
  "\\bsupply constrained\\b", "\\bpricing power\\b", "\\bmargin expansion\\b",
  "\\bearnings revision(s)?\\b", "\\bbeneficiar(y|ies)\\b", "\\btailwind(s)?\\b",
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
  "\\bunderperform\\b", "\\bdowngrade(s|d)?\\b", "\\bmiss(es|ed|ing)?\\b",
  "\\bweak demand\\b", "\\bdemand slowdown\\b", "\\bovercrowded\\b",
  "\\bcrowded trade\\b", "\\bmargin pressure\\b", "\\binventory pressure\\b",
  "\\bearnings cut(s)?\\b", "\\bheadwind(s)?\\b", "\\bpriced in\\b",
];

// Chinese keywords: no word boundaries needed (Chinese has no whitespace tokenization)
const BULLISH_CN = [
  "加仓", "看好", "看多", "买入", "上车", "抄底", "起飞", "底部",
  "利好", "做多", "建仓", "景气", "复苏", "突破", "上行", "反转",
  "主线", "机会", "超预期", "高增长", "受益", "催化", "放量",
  "资金流入", "修复", "改善", "供不应求", "涨价", "提价", "扩产",
  "订单饱满", "业绩上修", "估值修复", "政策支持", "国产替代",
];

const BEARISH_CN = [
  "减仓", "看空", "卖出", "下车", "见顶", "泡沫", "崩", "做空",
  "利空", "清仓", "逃顶", "下行", "承压", "走弱", "退潮", "风险",
  "低预期", "不及预期", "杀估值", "价格战", "库存压力", "去库存",
  "需求走弱", "需求放缓", "盈利下修", "业绩下修", "估值过高",
  "拥挤", "兑现", "补跌", "破位",
];

const NEGATION_EN = [
  "\\bnot\\b", "\\bno\\b", "\\bnever\\b", "\\bwithout\\b", "\\bavoid\\b",
  "\\bdoesn'?t\\b", "\\bdon'?t\\b", "\\bisn'?t\\b", "\\baren'?t\\b",
];

const NEGATION_CN = ["不", "没", "无", "别", "避免", "不是", "不能", "难以"];

const HISTORICAL_POSITION_EN = [
  /\b(last|past|previous)\s+(week|month|quarter|year)\b/i,
  /\b(previously|earlier|back then|at the time|used to)\b/i,
  /\b(sold|trimmed|exited|closed|reduced)\b/i,
];

const HISTORICAL_POSITION_CN = [
  "上周",
  "上个月",
  "上季度",
  "去年",
  "之前",
  "此前",
  "当时",
  "曾经",
  "卖了",
  "抛了",
  "减了",
  "清仓了",
  "退出了",
];

const CURRENT_VIEW_EN = [
  /\b(now|today|currently|still|here|going forward|from here|next|expect|think|should|will)\b/i,
  /\b(room to run|upside|downside|target|thesis|setup)\b/i,
];

const CURRENT_VIEW_CN = [
  "现在",
  "目前",
  "今天",
  "仍然",
  "继续",
  "接下来",
  "后面",
  "未来",
  "预计",
  "认为",
  "看好",
  "看空",
  "还有空间",
];

const bullishEnRegexes = BULLISH_EN.map((p) => new RegExp(p, "i"));
const bearishEnRegexes = BEARISH_EN.map((p) => new RegExp(p, "i"));
const negationEnRegexes = NEGATION_EN.map((p) => new RegExp(p, "i"));

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function windowsAroundTarget(text: string, target?: string): string[] {
  if (!target) return [text];
  const cleanTarget = target.replace(/^\$/, "").trim();
  if (!cleanTarget) return [text];

  const matcher = new RegExp(`\\$?${escapeRegex(cleanTarget)}`, "gi");
  const windows: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(text)) !== null) {
    const start = Math.max(0, match.index - TARGET_WINDOW_CHARS);
    const end = Math.min(text.length, match.index + match[0].length + TARGET_WINDOW_CHARS);
    windows.push(text.slice(start, end));
  }
  return windows.length > 0 ? windows : [text];
}

function hasNearbyNegation(scope: string, matchIndex: number): boolean {
  const prefix = scope.slice(Math.max(0, matchIndex - 24), matchIndex);
  const lowerPrefix = prefix.toLowerCase();
  return (
    negationEnRegexes.some((re) => re.test(prefix)) ||
    NEGATION_CN.some((kw) => lowerPrefix.includes(kw))
  );
}

function scoreRegexes(scope: string, regexes: RegExp[]): number {
  let score = 0;
  for (const re of regexes) {
    re.lastIndex = 0;
    const match = re.exec(scope);
    if (!match) continue;
    score += hasNearbyNegation(scope, match.index) ? -1 : 1;
  }
  return score;
}

function scoreKeywords(scope: string, keywords: string[]): number {
  const lower = scope.toLowerCase();
  let score = 0;
  for (const kw of keywords) {
    const idx = lower.indexOf(kw.toLowerCase());
    if (idx < 0) continue;
    score += hasNearbyNegation(scope, idx) ? -1 : 1;
  }
  return score;
}

function isHistoricalOnlyPositionScope(scope: string): boolean {
  const lower = scope.toLowerCase();
  const hasHistoricalMarker =
    HISTORICAL_POSITION_EN.some((re) => re.test(scope)) ||
    HISTORICAL_POSITION_CN.some((kw) => lower.includes(kw));
  if (!hasHistoricalMarker) return false;

  const hasCurrentView =
    CURRENT_VIEW_EN.some((re) => re.test(scope)) ||
    CURRENT_VIEW_CN.some((kw) => lower.includes(kw));
  return !hasCurrentView;
}

export function detectSentimentByRules(
  text: string,
  target?: string
): Sentiment | null {
  let bullCount = 0;
  let bearCount = 0;

  for (const scope of windowsAroundTarget(text, target)) {
    if (isHistoricalOnlyPositionScope(scope)) continue;
    bullCount += scoreRegexes(scope, bullishEnRegexes);
    bullCount += scoreKeywords(scope, BULLISH_CN);
    bearCount += scoreRegexes(scope, bearishEnRegexes);
    bearCount += scoreKeywords(scope, BEARISH_CN);
  }

  if (bullCount > bearCount) return "bullish";
  if (bearCount > bullCount) return "bearish";
  return null;
}

export async function detectSentiment(
  text: string,
  target: string
): Promise<Sentiment | null> {
  const provider = getAiProvider("sentiment");
  if (!provider) return null;

  try {
    const systemPrompt = `You are a financial market sentiment classifier. Your task is to determine whether the author of a social media post is BULLISH or BEARISH on a specific target.

The target is usually a stock ticker or ETF (not a sector — sector sentiment is handled elsewhere).

DEFINITIONS:
- BULLISH: The author expects the target to rise, outperform, attract capital, improve fundamentally, or become a promising market direction. This includes: recommending to buy, holding long exposure, setting upside targets, celebrating gains, defending a thesis, calling it a main theme, saying fundamentals are improving, or saying the target benefits from a trend.
- BEARISH: The author expects the target to fall, underperform, lose capital, deteriorate fundamentally, or become a risky market direction. This includes: recommending to sell/short, warning about overvaluation, predicting decline, criticizing fundamentals, saying a theme is crowded/over, or expressing regret about holding.

IMPORTANT RULES:
1. Focus on MARKET SENTIMENT for the target, not general emotion.
2. If the post says a sector/theme has improving demand, policy support, capital inflow, earnings upgrades, or a breakout, classify bullish.
3. If the post says a sector/theme is crowded, deteriorating, overvalued, losing demand, or breaking down, classify bearish.
4. If a stock is mentioned as a positive example inside a target sector, that can be bullish for the sector.
5. If the author mentions the target only in passing or as historical context without expressing a current view, reply unknown.
6. A completed past trade is not automatically current sentiment. "Sold last month", "trimmed earlier", "之前卖了", or "上个月抛了" should be unknown unless the author also gives a current forward-looking view on that exact target.
7. A post may mention multiple tickers or sectors. Classify sentiment ONLY for the requested target.

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
Answer: unknown
Reason: The NVDA sale is a completed historical action. The current bullish view is on AXTI and AAOI, not NVDA.

Tweet: "上个月卖了 $TSLA，后来涨跌都和我无关了。"
Ticker: TSLA
Answer: unknown
Reason: The author only describes a past exit and gives no current forward-looking view.

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
          model: getAiFallbackModel(),
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
