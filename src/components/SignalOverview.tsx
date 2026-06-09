"use client";

import { useState, useEffect } from "react";
import { useMarket } from "@/lib/market-context";
import SentimentLight from "./SentimentLight";
import CredibilityBadge from "./CredibilityBadge";
import AvatarWall from "./AvatarWall";
import MiniSparkline from "./MiniSparkline";
import SectorDetail from "./SectorDetail";

interface SectorSummary {
  id: string;
  slug: string;
  name: string;
  description: string;
  mentionCount: number;
  uniqueBloggerCount: number;
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

interface Props {
  onSelectTicker: (ticker: string | null) => void;
}

export default function SignalOverview({ onSelectTicker }: Props) {
  const { market } = useMarket();
  const [sectors, setSectors] = useState<SectorSummary[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedSector, setSelectedSector] = useState<SectorSummary | null>(
    null
  );

  useEffect(() => {
    setLoading(true);
    setSelectedSector(null);

    Promise.all([
      fetch(`/api/sectors/overview?market=${market}&days=30`).then((r) =>
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

  // Find hottest, strongest, warning signals
  const hottest =
    sectors.length > 0
      ? sectors.reduce((a, b) =>
          a.mentionCount > b.mentionCount ? a : b
        )
      : null;
  const strongest = sectors
    .filter((s) => s.signalStrength !== 50)
    .sort(
      (a, b) =>
        Math.abs(b.signalStrength - 50) - Math.abs(a.signalStrength - 50)
    )[0] ?? null;
  const warning =
    sectors.filter((s) => s.trend === "down").length > 0
      ? sectors.find((s) => s.trend === "down") ?? null
      : null;

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
          subtitle={hottest ? `${hottest.mentionCount}条 · ${hottest.uniqueBloggerCount}位博主` : undefined}
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
          value={strongest?.primaryEtf?.ticker ?? "—"}
          subtitle={
            strongest?.confidenceLabel === "高"
              ? "高可信博主一致看好 · 点击查看K线"
              : "点击查看K线"
          }
          highlight
          onClick={() => {
            if (strongest?.primaryEtf) {
              onSelectTicker(strongest.primaryEtf.ticker);
            }
          }}
        />
      </div>

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
            className={`w-full text-left p-4 rounded-xl border transition-all duration-200 bg-[var(--card-bg)] border-[var(--border-soft)] hover:border-[var(--accent-green)]/30 hover:shadow-sm ${
              selectedSector?.id === sector.id
                ? "border-[var(--accent-green)]/50 shadow-md"
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
                    <div className="flex-1 h-1.5 rounded-full bg-[var(--border-soft)] overflow-hidden">
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
                    {sector.mentionCount} 条提及 · {sector.uniqueBloggerCount}{" "}
                    位博主
                    {sector.topBloggers.filter((b) => b.score >= 70).length >
                      0 &&
                      ` · ${
                        sector.topBloggers.filter((b) => b.score >= 70).length
                      } 位高可信`}
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
        <div className="mt-6">
          <SectorDetail
            slug={selectedSector.slug}
            onClose={() => setSelectedSector(null)}
            onSelectTicker={onSelectTicker}
          />
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[var(--card-bg)] border border-[var(--border-soft)] rounded-xl p-3 text-center">
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
      className={`text-left p-3 rounded-xl border transition-all duration-200 bg-[var(--card-bg)] border-[var(--border-soft)] hover:border-[var(--accent-green)]/30 hover:shadow-sm ${
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
