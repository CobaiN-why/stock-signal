import type { StockProfile } from "./yahoo";

const KIMI_API_URL = "https://api.moonshot.cn/v1/chat/completions";

/**
 * Generate HV analysis for a stock using Kimi API.
 * Horizontal: competitive landscape & market position
 * Vertical: development history & key milestones
 */
export async function generateStockAnalysis(
  ticker: string,
  profile: StockProfile
): Promise<string> {
  const apiKey = process.env.KIMI_API_KEY;
  if (!apiKey) throw new Error("KIMI_API_KEY not set");

  const prompt = `你是一位资深的股票研究分析师。请对以下股票进行深度分析，采用"纵横分析法"：

**股票信息：**
- 代码：${ticker}
- 公司名：${profile.longName || profile.shortName}
- 行业：${profile.sector} / ${profile.industry}
- 市值：${profile.marketCap ? `$${(profile.marketCap / 1e9).toFixed(1)}B` : "未知"}
- PE (TTM)：${profile.pe?.toFixed(1) ?? "N/A"}
- Forward PE：${profile.forwardPe?.toFixed(1) ?? "N/A"}
- EPS：${profile.eps?.toFixed(2) ?? "N/A"}
- 52周范围：$${profile.fiftyTwoWeekLow?.toFixed(2) ?? "?"} - $${profile.fiftyTwoWeekHigh?.toFixed(2) ?? "?"}
- 公司简介：${profile.description.slice(0, 500)}

**分析要求：**

## 一、纵向分析（发展脉络）
梳理这家公司从创立到现在的关键发展节点、战略转折点、重要产品或业务线变化。不要泛泛而谈，要有具体的时间点和事件。

## 二、横向分析（竞争格局）
分析其所在行业的竞争格局，列出3-5个主要竞争对手，比较它们的：
- 技术路线差异
- 商业模式差异
- 市场份额与定位
- 各自优劣势

## 三、交叉洞察
结合纵向发展历程和横向竞争位置，给出：
- 当前估值是否合理的判断
- 未来1-2年的关键看点和风险
- 该公司最独特的竞争壁垒是什么

**写作风格：**
- 用中文输出
- 语言干练，判断清晰，有观点
- 叙事驱动而非列表堆砌
- 不要用"首先其次最后"、"赋能"等空话
- 不要使用 Markdown 格式（不要用 #、**、- 列表等），直接用纯文本段落，段落之间空一行
- 小标题用"一、""二、""三、"这样的中文序号，独占一行即可
- 总字数控制在 3000-5000 字`;

  const res = await fetch(KIMI_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "moonshot-v1-32k",
      messages: [
        {
          role: "system",
          content: "你是一位深谙资本市场的研究分析师，擅长结合历史发展脉络和竞争格局进行深度分析。",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.7,
      max_tokens: 8192,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Kimi API error: ${res.status} ${errText}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}
