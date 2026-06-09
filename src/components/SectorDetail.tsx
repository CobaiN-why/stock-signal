"use client";

import { useState, useEffect, useRef } from "react";
import { useMarket } from "@/lib/market-context";
import SentimentLight from "./SentimentLight";
import CredibilityBadge from "./CredibilityBadge";
import AvatarWall from "./AvatarWall";
import MiniSparkline from "./MiniSparkline";
import PriceChart from "./PriceChart";
import PostTimeline from "./PostTimeline";

interface SectorDetailData {
  id: string;
  slug: string;
  name: string;
  description: string;
  stats: {
    mentionCount: number;
    bullishCount: number;
    bearishCount: number;
  };
  signalStrength: number;
  confidenceLabel: "高" | "中" | "低";
  trend: { date: string; bullish: number; bearish: number; ratio: number | null }[];
  topBloggers: {
    xUsername: string;
    displayName: string;
    color: string;
    score: number;
    accuracyRate: number | null;
    totalPredictions: number;
  }[];
  etfs: {
    ticker: string;
    market: string;
    name: string;
    rationale: string;
    rank: number;
  }[];
  recentOpinions: {
    id: string;
    sentiment: string | null;
    confidence: number;
    evidence: string;
    post: {
      id: string;
      content: string;
      postedAt: string;
      url: string;
      blogger: {
        xUsername: string;
        displayName: string;
        color: string;
      };
    };
    backtest: {
      result: string;
      returnPct: number;
      windowDays: number;
      priceBefore: number;
      priceAfter: number;
    } | null;
  }[];
}

interface Props {
  slug: string;
  initialChartTicker?: string;
  onClose: () => void;
}

export default function SectorDetail({ slug, initialChartTicker, onClose }: Props) {
  const { market } = useMarket();
  const [data, setData] = useState<SectorDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [chartTicker, setChartTicker] = useState<string | null>(initialChartTicker ?? null);
  const [chartBlogger, setChartBlogger] = useState<string | null>(null);
  const [highlightPostId, setHighlightPostId] = useState<string | null>(null);
  const chartRef = useRef<HTMLDivElement>(null);

  const handleMentionClick = (postId: string) => {
    setHighlightPostId(postId);
    setTimeout(() => setHighlightPostId(null), 3000);
  };

  const handleSelectTicker = (ticker: string) => {
    setChartTicker(ticker);
    // Auto-scroll to chart after render
    setTimeout(() => {
      chartRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 100);
  };

  useEffect(() => {
    setLoading(true);
    fetch(`/api/sectors/${slug}?market=${market}&days=3`)
      .then((r) => r.json())
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [slug, market]);

  if (loading) {
    return (
      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-6 text-center text-[var(--text-secondary)]">
        加载中...
      </div>
    );
  }

  if (!data) {
    return (
      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-6 text-center text-[var(--text-secondary)]">
        数据加载失败
      </div>
    );
  }

  return (
    <div className="bg-[var(--bg-card)] border border-[var(--accent)]/30 rounded-xl p-6 shadow-md">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
          >
            ← 返回
          </button>
          <h2 className="font-serif-title text-base">{data.name}</h2>
          <SentimentLight signalStrength={data.signalStrength} size="md" />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-[var(--text-primary)]">
            信号强度 {Math.abs(data.signalStrength - 50) * 2}
          </span>
          <CredibilityBadge
            score={Math.abs(data.signalStrength - 50) * 2}
            label={data.confidenceLabel}
            showScore={false}
          />
        </div>
      </div>

      {/* Stats + Sparkline row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        {/* Sparkline */}
        <div>
          <h4 className="text-xs font-medium text-[var(--text-secondary)] mb-2">
            多空比趋势 (近30天)
          </h4>
          <MiniSparkline data={data.trend} width={240} height={48} />
          <div className="flex justify-between text-xs text-[var(--text-secondary)] mt-1">
            <span>{data.trend[0]?.date ?? ""}</span>
            <span>
              {data.trend[data.trend.length - 1]?.date ?? ""}
            </span>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-[var(--bg-hover)] rounded-lg p-3 text-center">
            <div className="text-lg font-bold text-red-500">
              {data.stats.bullishCount}
            </div>
            <div className="text-xs text-[var(--text-secondary)]">看多</div>
          </div>
          <div className="bg-[var(--bg-hover)] rounded-lg p-3 text-center">
            <div className="text-lg font-bold text-green-500">
              {data.stats.bearishCount}
            </div>
            <div className="text-xs text-[var(--text-secondary)]">看空</div>
          </div>
          <div className="bg-[var(--bg-hover)] rounded-lg p-3 text-center">
            <div className="text-lg font-bold">{data.stats.mentionCount}</div>
            <div className="text-xs text-[var(--text-secondary)]">总提及</div>
          </div>
          <div className="bg-[var(--bg-hover)] rounded-lg p-3 text-center">
            <div className="text-lg font-bold">{data.topBloggers.length}</div>
            <div className="text-xs text-[var(--text-secondary)]">覆盖博主</div>
          </div>
        </div>
      </div>

      {/* Top bloggers */}
      <div className="mb-6">
        <h4 className="text-xs font-medium text-[var(--text-secondary)] mb-2">
          高可信博主
        </h4>
        <div className="flex items-center gap-3">
          <AvatarWall bloggers={data.topBloggers} max={8} size="md" />
          <div className="text-xs text-[var(--text-secondary)]">
            {data.topBloggers.filter((b) => b.score >= 70).length} 位高可信
          </div>
        </div>
        {/* Blogger list with scores */}
        <div className="mt-3 flex flex-wrap gap-2">
          {data.topBloggers.slice(0, 6).map((b) => (
            <span
              key={b.xUsername}
              className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-[var(--bg-hover)] text-xs"
            >
              <span
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: b.color }}
              />
              <span className="text-[var(--text-primary)]">
                @{b.xUsername}
              </span>
              <CredibilityBadge score={b.score} />
              {b.accuracyRate !== null && (
                <span className="text-[var(--text-secondary)]">
                  {Math.round(b.accuracyRate * 100)}%
                </span>
              )}
            </span>
          ))}
        </div>
      </div>

      {/* ETF recommendations */}
      {data.etfs.length > 0 && (
        <div className="mb-6">
          <h4 className="text-xs font-medium text-[var(--text-secondary)] mb-2">
            推荐 ETF
          </h4>
          <div className="flex flex-wrap gap-2">
            {data.etfs.map((etf, i) => (
              <button
                key={etf.ticker}
                onClick={() => handleSelectTicker(etf.ticker)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                  chartTicker === etf.ticker
                    ? "bg-[var(--accent)]/10 border-[var(--accent)]/40 text-[var(--accent)]"
                    : "bg-[var(--bg-hover)] border-[var(--border)] hover:border-[var(--accent)]/40"
                }`}
              >
                <span className="text-xs text-[var(--text-secondary)]">
                  {i === 0 ? "🥇" : i === 1 ? "🥈" : "🥉"}
                </span>
                <span className="font-mono font-medium">{etf.ticker}</span>
                <span className="text-[var(--text-secondary)]">{etf.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Inline K-line chart — expands when ETF is clicked */}
      {chartTicker && (
        <div ref={chartRef} className="mb-6 border border-[var(--accent)]/20 rounded-xl overflow-hidden">
          <div className="bg-[var(--bg-hover)] px-4 py-2 flex items-center justify-between border-b border-[var(--border)]">
            <h4 className="text-xs font-medium text-[var(--text-primary)]">
              📈 {chartTicker} · K 线图
            </h4>
            <button
              onClick={() => setChartTicker(null)}
              className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              收起 ✕
            </button>
          </div>
          <div className="p-3">
            <PriceChart
              market={market}
              ticker={chartTicker}
              selectedBlogger={chartBlogger}
              onMentionClick={handleMentionClick}
            />
          </div>
          <div className="border-t border-[var(--border)] p-3">
            <PostTimeline
              market={market}
              ticker={chartTicker}
              selectedBlogger={chartBlogger}
              highlightPostId={highlightPostId}
            />
          </div>
        </div>
      )}

      {/* Recent opinions with backtest */}
      <div>
        <h4 className="text-xs font-medium text-[var(--text-secondary)] mb-2">
          近期观点 ({data.recentOpinions.length})
        </h4>
        <div className="space-y-2 max-h-80 overflow-y-auto">
          {data.recentOpinions.map((op) => (
            <div
              key={op.id}
              className="flex items-start gap-3 p-3 rounded-lg bg-[var(--bg-hover)] text-sm"
            >
              <span
                className="w-4 h-4 rounded-full mt-0.5 shrink-0"
                style={{ backgroundColor: op.post.blogger.color }}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium text-[var(--text-primary)] text-xs">
                    @{op.post.blogger.xUsername}
                  </span>
                  <span
                    className={`text-xs font-medium ${
                      op.sentiment === "bullish"
                        ? "text-red-500"
                        : op.sentiment === "bearish"
                          ? "text-green-500"
                          : "text-[var(--text-secondary)]"
                    }`}
                  >
                    {op.sentiment === "bullish"
                      ? "看多"
                      : op.sentiment === "bearish"
                        ? "看空"
                        : "未知"}
                  </span>
                  {op.backtest && (
                    <BacktestTag
                      result={op.backtest.result}
                      returnPct={op.backtest.returnPct}
                    />
                  )}
                  {!op.backtest && op.sentiment && (
                    <span className="text-xs text-[var(--text-secondary)]">
                      ⏳ 待验证
                    </span>
                  )}
                </div>
                <p className="text-xs text-[var(--text-secondary)] line-clamp-2">
                  {op.post.content}
                </p>
                <div className="flex items-center gap-2 mt-1 text-xs text-[var(--text-secondary)]">
                  <span>
                    {new Date(op.post.postedAt).toLocaleDateString("zh-CN")}
                  </span>
                  <a
                    href={op.post.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[var(--accent)] hover:underline"
                  >
                    查看原帖 →
                  </a>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function BacktestTag({
  result,
  returnPct,
}: {
  result: string;
  returnPct: number;
}) {
  const config = {
    correct: {
      label: "正确",
      icon: "✅",
      color: "bg-emerald-100 text-emerald-700",
    },
    incorrect: {
      label: "错误",
      icon: "❌",
      color: "bg-red-100 text-red-700",
    },
    neutral: {
      label: "中性",
      icon: "⚪",
      color: "bg-gray-100 text-gray-500",
    },
  }[result] ?? { label: result, icon: "", color: "bg-gray-100 text-gray-500" };

  const sign = returnPct >= 0 ? "+" : "";

  return (
    <span
      className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs font-medium ${config.color}`}
      title={`${config.label}: ${sign}${returnPct.toFixed(1)}%`}
    >
      {config.icon} {sign}
      {returnPct.toFixed(1)}%
    </span>
  );
}
