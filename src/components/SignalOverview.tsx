"use client";

import { useState, useEffect, useRef } from "react";
import { useMarket } from "@/lib/market-context";
import SentimentLight from "./SentimentLight";
import CredibilityBadge from "./CredibilityBadge";
import AvatarWall from "./AvatarWall";
import MiniSparkline from "./MiniSparkline";
import SectorDetail from "./SectorDetail";
import FundFlowPanel from "./FundFlowPanel";

interface SectorSummary {
  id: string;
  slug: string;
  name: string;
  description: string;
  mentionCount: number;
  uniqueBloggerCount: number;
  strongMentionCount: number;
  weakMentionCount: number;
  bullishCount: number;
  bearishCount: number;
  bullBearRatio: number | null;
  signalStrength: number;
  confidenceLabel: "高" | "中" | "低";
  trend: "up" | "down" | "stable";
  topBloggers: {
    xUsername: string;
    displayName: string;
    color: string;
    score: number;
    mentionCount?: number;
  }[];
  primaryEtf: {
    ticker: string;
    market: string;
    name: string;
  } | null;
}

interface Stats {
  postCount: number;
  stockCount: number;
  bloggerCount: number;
  lastUpdated: string | null;
}

export default function SignalOverview() {
  const { market } = useMarket();
  const [sectors, setSectors] = useState<SectorSummary[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedSector, setSelectedSector] = useState<SectorSummary | null>(null);
  const [chartForSector, setChartForSector] = useState<string | null>(null);
  const detailRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to detail when a sector is selected
  useEffect(() => {
    if (selectedSector && detailRef.current) {
      detailRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [selectedSector]);

  useEffect(() => {
    setLoading(true);
    setSelectedSector(null);

    Promise.all([
      fetch(`/api/sectors/overview?market=${market}&days=3`).then((r) =>
        r.json()
      ),
      fetch(`/api/stats?market=${market}`).then((r) => r.json()),
    ])
      .then(([sectorData, statsData]) => {
        setSectors(sectorData.sectors ?? []);
        setStats(statsData);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [market]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-[var(--text-secondary)]">
        加载中...
      </div>
    );
  }

  // Quality threshold: require enough data points for signal cards
  const MIN_MENTIONS = 3;
  const MIN_BLOGGERS = 2;

  // 最热板块: most total mentions
  const hottest = sectors
    .sort((a, b) => b.mentionCount - a.mentionCount)[0] ?? null;

  // 最强信号: strongest bullish consensus (uses strong mentions for quality)
  const strongest = sectors
    .filter(
      (s) =>
        s.signalStrength > 55 &&
        s.strongMentionCount >= MIN_MENTIONS
    )
    .sort((a, b) => b.signalStrength - a.signalStrength)[0] ?? null;

  // 值得警惕: most bearish sector
  const warning =
    sectors
      .filter(
        (s) =>
          s.signalStrength < 45 &&
          s.strongMentionCount >= MIN_MENTIONS
      )
      .sort((a, b) => a.signalStrength - b.signalStrength)[0] ?? null;

  return (
    <div>
      {/* Stats bar */}
      {stats && (
        <div className="grid grid-cols-4 gap-3 mb-6">
          <StatCard label="帖子数" value={stats.postCount.toLocaleString()} />
          <StatCard label="标的数" value={stats.stockCount.toLocaleString()} />
          <StatCard
            label="博主数"
            value={stats.bloggerCount.toLocaleString()}
          />
          <StatCard
            label="最近更新"
            value={
              stats.lastUpdated
                ? new Date(stats.lastUpdated).toLocaleDateString("zh-CN", {
                    month: "short",
                    day: "numeric",
                  })
                : "—"
            }
          />
        </div>
      )}

      {/* Today's signal summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        <SummaryCard
          emoji="🔥"
          title="最热板块"
          value={hottest?.name ?? "—"}
          subtitle={hottest ? `${hottest.mentionCount}条提及 · ${hottest.uniqueBloggerCount}位博主${hottest.strongMentionCount > 0 ? ` · ${hottest.strongMentionCount}强关联` : ""}` : undefined}
          onClick={() => hottest && setSelectedSector(hottest)}
        />
        <SummaryCard
          emoji="🟢"
          title="最强信号"
          value={strongest?.name ?? "—"}
          subtitle={
            strongest
              ? `信号强度 ${strongest.signalStrength}`
              : undefined
          }
          onClick={() => strongest && setSelectedSector(strongest)}
        />
        <SummaryCard
          emoji="⚠️"
          title="值得警惕"
          value={warning?.name ?? "—"}
          subtitle={warning ? "情绪降温" : undefined}
          highlight
          onClick={() => warning && setSelectedSector(warning)}
        />
        <SummaryCard
          emoji="📌"
          title="推荐关注"
          value={strongest?.primaryEtf?.name ?? strongest?.primaryEtf?.ticker ?? "—"}
          subtitle={
            strongest?.primaryEtf
              ? `${strongest.primaryEtf.ticker} · 点击查看K线`
              : "暂无推荐"
          }
          highlight
          onClick={() => {
            if (strongest) {
              setChartForSector(strongest.primaryEtf?.ticker ?? null);
              setSelectedSector(strongest);
            }
          }}
        />
      </div>

      {/* Fund flow panel — only for A-share market */}
      {market === "CN" && (
        <div className="mb-8">
          <FundFlowPanel />
        </div>
      )}

      {/* Sector signal list */}
      <h2 className="font-serif-title text-sm mb-4">板块信号</h2>
      <div className="space-y-3">
        {sectors.length === 0 && (
          <p className="text-[var(--text-secondary)] text-sm py-8 text-center">
            暂无板块数据
          </p>
        )}
        {sectors.map((sector) => (
          <button
            key={sector.id}
            onClick={() => setSelectedSector(sector)}
            className={`w-full text-left p-4 rounded-xl border transition-all duration-200 bg-[var(--bg-card)] border-[var(--border)] hover:border-[var(--accent)]/30 hover:shadow-sm ${
              selectedSector?.id === sector.id
                ? "border-[var(--accent)]/50 shadow-md"
                : ""
            }`}
          >
            <div className="flex items-center gap-4">
              {/* Sentiment indicator */}
              <SentimentLight
                signalStrength={sector.signalStrength}
                size="lg"
              />

              {/* Sector info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-[var(--text-primary)]">
                    {sector.name}
                  </span>
                  {sector.primaryEtf && (
                    <span className="text-xs text-[var(--text-secondary)] font-mono">
                      {sector.primaryEtf.ticker}
                    </span>
                  )}
                  <CredibilityBadge
                    score={Math.abs(sector.signalStrength - 50) * 2}
                    label={sector.confidenceLabel}
                    showScore={false}
                  />
                </div>

                {/* Bull/bear ratio bar */}
                {sector.bullBearRatio !== null && (
                  <div className="mt-1.5 flex items-center gap-2">
                    <div className="flex-1 h-1.5 rounded-full bg-[var(--border)] overflow-hidden">
                      <div
                        className="h-full rounded-full bg-red-400 transition-all"
                        style={{ width: `${sector.bullBearRatio}%` }}
                      />
                    </div>
                    <span className="text-xs text-[var(--text-secondary)] whitespace-nowrap">
                      看多 {sector.bullBearRatio}% · 看空{" "}
                      {100 - sector.bullBearRatio}%
                    </span>
                  </div>
                )}

                {/* Meta row */}
                <div className="flex items-center gap-4 mt-2 text-xs text-[var(--text-secondary)]">
                  <span>
                    {sector.mentionCount} 条提及 ({sector.strongMentionCount} 强关联
                    {sector.weakMentionCount > 0 && ` + ${sector.weakMentionCount} 弱关联`})
                    {" · "}
                    {sector.uniqueBloggerCount} 位博主
                  </span>
                  <span>
                    趋势{" "}
                    {sector.trend === "up"
                      ? "↗ 看多升温"
                      : sector.trend === "down"
                        ? "↘ 看空升温"
                        : "→ 持平"}
                  </span>
                </div>
              </div>

              {/* Avatar wall */}
              <div className="hidden sm:block">
                <AvatarWall bloggers={sector.topBloggers} max={4} />
              </div>

              {/* Expand arrow */}
              <span className="text-[var(--text-secondary)] text-lg">
                ›
              </span>
            </div>
          </button>
        ))}
      </div>

      {/* Sector detail panel */}
      {selectedSector && (
        <div ref={detailRef} className="mt-6">
          <SectorDetail
            slug={selectedSector.slug}
            initialChartTicker={chartForSector ?? undefined}
            onClose={() => { setSelectedSector(null); setChartForSector(null); }}
          />
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-3 text-center">
      <div className="text-xl font-mono font-bold text-[var(--text-primary)]">
        {value}
      </div>
      <div className="text-xs text-[var(--text-secondary)] mt-0.5">
        {label}
      </div>
    </div>
  );
}

function SummaryCard({
  emoji,
  title,
  value,
  subtitle,
  highlight,
  onClick,
}: {
  emoji: string;
  title: string;
  value: string;
  subtitle?: string;
  highlight?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`text-left p-3 rounded-xl border transition-all duration-200 bg-[var(--bg-card)] border-[var(--border)] hover:border-[var(--accent)]/30 hover:shadow-sm ${
        highlight ? "ring-1 ring-amber-200" : ""
      }`}
    >
      <div className="text-xs text-[var(--text-secondary)] mb-1">
        {emoji} {title}
      </div>
      <div className="font-semibold text-sm text-[var(--text-primary)] truncate">
        {value}
      </div>
      {subtitle && (
        <div className="text-xs text-[var(--text-secondary)] mt-0.5 truncate">
          {subtitle}
        </div>
      )}
    </button>
  );
}
