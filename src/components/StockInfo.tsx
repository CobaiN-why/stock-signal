"use client";

import { useEffect, useState } from "react";

interface StockProfile {
  shortName: string;
  longName: string;
  sector: string;
  industry: string;
  marketCap: number | null;
  pe: number | null;
  forwardPe: number | null;
  eps: number | null;
  dividendYield: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  avgVolume: number | null;
  description: string;
}

interface MentionForSentiment {
  sentiment: string | null;
  post: {
    postedAt: string;
    blogger: {
      xUsername: string;
      color: string;
    };
  };
}

interface StockData {
  ticker: string;
  companyName: string;
  latestPrice: string | null;
  profile: StockProfile | null;
  analysis: string | null;
  mentions?: MentionForSentiment[];
  cumulativeReturn?: number | null;
  firstMentionDate?: string | null;
}

interface Props {
  ticker: string | null;
}

function formatMarketCap(n: number | null): string {
  if (!n) return "—";
  if (n >= 1e12) return `$${(n / 1e12).toFixed(1)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`;
  return `$${n.toLocaleString()}`;
}

function formatVolume(n: number | null): string {
  if (!n) return "—";
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return n.toLocaleString();
}

/**
 * Render analysis text as React nodes.
 * - Strips markdown syntax (##, **, -, ```)
 * - Lines matching subtitle patterns (e.g. "一、纵向分析（发展脉络）") rendered bold
 * - Everything else as plain text paragraphs
 */
function renderAnalysis(md: string): React.ReactNode[] {
  // Clean markdown artifacts
  const clean = md
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/^[-*]\s+/gm, "• ")
    .replace(/^\d+\.\s+/gm, "")
    .replace(/^---+$/gm, "")
    .replace(/`(.+?)`/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  // Subtitle pattern: lines starting with 一、二、三、 or (一) or 1. style Chinese section headers
  const subtitleRe = /^[一二三四五六七八九十]+[、.．]\s*.+$/;

  return clean.split("\n").map((line, i) => {
    if (subtitleRe.test(line.trim())) {
      return (
        <span key={i} className="font-bold block mt-4 mb-1">
          {line}
          {"\n"}
        </span>
      );
    }
    return <span key={i}>{line}{"\n"}</span>;
  });
}

function SentimentModule({
  mentions,
  cumulativeReturn,
  firstMentionDate,
}: {
  mentions: MentionForSentiment[];
  cumulativeReturn: number | null;
  firstMentionDate: string | null;
}) {
  const [expanded, setExpanded] = useState(false);

  // Per-blogger latest sentiment + history
  const bloggerMap = new Map<
    string,
    { color: string; history: { sentiment: string; date: string }[] }
  >();

  const sorted = [...mentions]
    .filter((m) => m.sentiment)
    .sort(
      (a, b) =>
        new Date(a.post.postedAt).getTime() -
        new Date(b.post.postedAt).getTime()
    );

  for (const m of sorted) {
    const key = m.post.blogger.xUsername;
    if (!bloggerMap.has(key)) {
      bloggerMap.set(key, { color: m.post.blogger.color, history: [] });
    }
    bloggerMap.get(key)!.history.push({
      sentiment: m.sentiment!,
      date: new Date(m.post.postedAt).toLocaleDateString("zh-CN"),
    });
  }

  // Latest sentiment per blogger
  let bullishCount = 0;
  let bearishCount = 0;
  const flippedBloggers: { username: string; from: string; to: string }[] = [];

  for (const [username, data] of bloggerMap) {
    const latest = data.history[data.history.length - 1];
    if (latest.sentiment === "bullish") bullishCount++;
    else bearishCount++;

    // Check for flips
    for (let i = 1; i < data.history.length; i++) {
      if (data.history[i].sentiment !== data.history[i - 1].sentiment) {
        flippedBloggers.push({
          username,
          from: data.history[i - 1].sentiment,
          to: data.history[i].sentiment,
        });
      }
    }
  }

  const total = bullishCount + bearishCount;
  const hasSentimentData = total > 0;
  const hasCumulativeReturn = cumulativeReturn !== null;

  if (!hasSentimentData && !hasCumulativeReturn) return null;

  const bullishPct = total > 0 ? (bullishCount / total) * 100 : 0;

  return (
    <div className="border-t border-[var(--border-soft)] pt-4 mb-4">
      <div className="flex items-start gap-6">
        {/* Left: Cumulative return hero */}
        {hasCumulativeReturn && (
          <div className="shrink-0">
            <div
              className="text-2xl font-bold font-mono"
              style={{
                color: cumulativeReturn! >= 0 ? "#dc2626" : "#16a34a",
              }}
            >
              {cumulativeReturn! >= 0 ? "+" : ""}
              {cumulativeReturn!.toFixed(1)}%
            </div>
            {firstMentionDate && (
              <div className="text-xs text-[var(--text-secondary)] mt-0.5">
                自 {firstMentionDate} 首次提及
              </div>
            )}
          </div>
        )}

        {/* Right: Sentiment summary */}
        {hasSentimentData && (
          <div className="flex-1 min-w-0">
            {/* Ratio bar */}
            <div className="flex h-2 rounded-full overflow-hidden mb-2">
              <div
                className="transition-all"
                style={{
                  width: `${bullishPct}%`,
                  backgroundColor: "#dc2626",
                }}
              />
              <div
                className="transition-all"
                style={{
                  width: `${100 - bullishPct}%`,
                  backgroundColor: "#16a34a",
                }}
              />
            </div>
            <div className="text-xs text-[var(--text-secondary)]">
              {bullishCount > 0 && bearishCount > 0
                ? `${bullishCount} 位看多，${bearishCount} 位看空`
                : bullishCount > 0
                  ? `全部看多（${bullishCount} 位）`
                  : `全部看空（${bearishCount} 位）`}
            </div>
            {/* Flip alerts */}
            {flippedBloggers.length > 0 && (
              <div className="mt-1 text-xs">
                {flippedBloggers.map((f, i) => (
                  <span key={i} className="text-amber-600">
                    ⚡ @{f.username} 观点反转（{f.from === "bullish" ? "多→空" : "空→多"}）
                    {i < flippedBloggers.length - 1 ? " " : ""}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Expandable blogger timeline */}
      {hasSentimentData && bloggerMap.size > 0 && (
        <div className="mt-3">
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
          >
            {expanded ? "▼" : "▶"} 博主观点时间线
          </button>
          {expanded && (
            <div className="mt-2 space-y-1.5">
              {Array.from(bloggerMap.entries()).map(([username, info]) => {
                const hasFlip = info.history.some(
                  (h, i) =>
                    i > 0 && h.sentiment !== info.history[i - 1].sentiment
                );
                return (
                  <div
                    key={username}
                    className={`flex items-center gap-2 text-xs ${hasFlip ? "bg-amber-50 rounded px-1.5 py-0.5" : ""}`}
                  >
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: info.color }}
                    />
                    <span className="font-mono w-24 truncate shrink-0">
                      @{username}
                    </span>
                    <div className="flex gap-1 flex-wrap">
                      {info.history.map((h, i) => (
                        <span
                          key={i}
                          title={h.date}
                          style={{
                            color:
                              h.sentiment === "bullish"
                                ? "#dc2626"
                                : "#16a34a",
                          }}
                        >
                          {h.sentiment === "bullish" ? "▲" : "▼"}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function StockInfo({ ticker }: Props) {
  const [data, setData] = useState<StockData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!ticker) {
      setData(null);
      return;
    }
    setLoading(true);
    fetch(`/api/stocks/${ticker}`)
      .then((r) => r.json())
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [ticker]);

  if (!ticker) {
    return (
      <div className="bg-[var(--card-bg)] border border-[var(--border-soft)] rounded-lg p-4 shadow-sm text-sm text-[var(--text-secondary)] text-center py-8">
        选择股票后显示基本信息与分析
      </div>
    );
  }

  if (loading || !data) {
    return (
      <div className="bg-[var(--card-bg)] border border-[var(--border-soft)] rounded-lg p-4 shadow-sm text-sm text-[var(--text-secondary)] text-center py-8">
        加载中...
      </div>
    );
  }

  const p = data.profile;

  const metrics = [
    { label: "市值", value: formatMarketCap(p?.marketCap ?? null) },
    { label: "PE (TTM)", value: p?.pe?.toFixed(1) ?? "—" },
    { label: "Forward PE", value: p?.forwardPe?.toFixed(1) ?? "—" },
    { label: "EPS", value: p?.eps ? `$${p.eps.toFixed(2)}` : "—" },
    {
      label: "52W Range",
      value:
        p?.fiftyTwoWeekLow && p?.fiftyTwoWeekHigh
          ? `$${p.fiftyTwoWeekLow.toFixed(0)} - $${p.fiftyTwoWeekHigh.toFixed(0)}`
          : "—",
    },
    { label: "Avg Vol", value: formatVolume(p?.avgVolume ?? null) },
  ];

  return (
    <div className="bg-[var(--card-bg)] border border-[var(--border-soft)] rounded-lg p-4 shadow-sm">
      {/* Company header */}
      <div className="mb-4">
        <h3 className="font-serif-title text-lg">
          {p?.longName || p?.shortName || data.companyName || data.ticker}
        </h3>
        {p?.sector && (
          <p className="text-xs text-[var(--text-secondary)] mt-0.5">
            {p.sector} / {p.industry}
          </p>
        )}
      </div>

      {/* Key metrics grid */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-3 mb-4">
        {metrics.map((m) => (
          <div key={m.label}>
            <div className="text-xs text-[var(--text-secondary)]">
              {m.label}
            </div>
            <div className="font-mono text-sm font-bold">{m.value}</div>
          </div>
        ))}
      </div>

      {/* Company description */}
      {p?.description && (
        <p className="text-xs text-[var(--text-secondary)] leading-relaxed mb-4 line-clamp-2">
          {p.description}
        </p>
      )}

      {/* Sentiment Divergence Module */}
      <SentimentModule
        mentions={data.mentions ?? []}
        cumulativeReturn={data.cumulativeReturn ?? null}
        firstMentionDate={data.firstMentionDate ?? null}
      />

      {/* HV Analysis — always visible */}
      {data.analysis && (
        <div className="border-t border-[var(--border-soft)] pt-4">
          <h4 className="text-sm font-bold text-[var(--accent-green)] mb-3">
            纵横分析报告
          </h4>
          <div className="text-sm leading-7 text-[var(--text-primary)] whitespace-pre-wrap">
            {renderAnalysis(data.analysis)}
          </div>
        </div>
      )}

      {!data.analysis && !p && (
        <p className="text-xs text-[var(--text-secondary)] text-center py-2">
          暂无基本面数据
        </p>
      )}
    </div>
  );
}
