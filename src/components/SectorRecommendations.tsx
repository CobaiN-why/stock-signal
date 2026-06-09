"use client";

import { useEffect, useState } from "react";
import type { Market } from "@/lib/markets";

interface Sector {
  id: string;
  market: string;
  slug: string;
  name: string;
  description: string;
  mentionCount: number;
  directCount: number;
  inferredCount: number;
  bullishCount: number;
  bearishCount: number;
  stockCount: number;
  recentOpinions: {
    id: string;
    confidence: number;
    evidence: string;
    sentiment: string | null;
    post: {
      id: string;
      postedAt: string;
      url: string;
      content: string;
      blogger: {
        xUsername: string;
        displayName: string;
        color: string;
      };
    };
  }[];
  etfs: {
    ticker: string;
    market: string;
    name: string;
    rationale: string;
    rank: number;
  }[];
}

interface Props {
  market: Market;
  selectedTicker: string | null;
  onSelectTicker: (ticker: string) => void;
}

export default function SectorRecommendations({
  market,
  selectedTicker,
  onSelectTicker,
}: Props) {
  const [sectors, setSectors] = useState<Sector[]>([]);

  useEffect(() => {
    fetch(`/api/sectors?market=${market}`)
      .then((r) => r.json())
      .then((d) => setSectors(d.sectors || []))
      .catch(() => {});
  }, [market]);

  const ranked = [...sectors].sort((a, b) => b.mentionCount - a.mentionCount);

  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-serif-title text-sm text-[var(--text-secondary)]">
          Sectors & ETF Ideas
        </h2>
        <span className="text-xs text-[var(--text-secondary)]">{market}</span>
      </div>

      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
        {ranked.map((sector) => (
          <div
            key={sector.id}
            className="border border-[var(--border)] rounded-lg p-3"
          >
            <div className="flex items-start justify-between gap-2 mb-1">
              <div>
                <h3 className="text-sm font-bold">{sector.name}</h3>
                <span className="text-xs text-[var(--text-secondary)]">
                  {sector.mentionCount} 次提及 · 直接 {sector.directCount} · 弱关联 {sector.inferredCount}
                </span>
              </div>
              {(sector.bullishCount > 0 || sector.bearishCount > 0) && (
                <span className="text-xs text-[var(--text-secondary)] whitespace-nowrap">
                  多 {sector.bullishCount} / 空 {sector.bearishCount}
                </span>
              )}
            </div>
            {sector.description && (
              <p className="text-xs text-[var(--text-secondary)] line-clamp-2 mb-2">
                {sector.description}
              </p>
            )}
            <div className="space-y-1">
              <p className="text-[10px] text-[var(--text-secondary)]">
                ETF 按规模优先排序
              </p>
              {sector.etfs.slice(0, 3).map((etf) => (
                <button
                  key={etf.ticker}
                  onClick={() => onSelectTicker(etf.ticker)}
                  className={`w-full flex items-center justify-between gap-2 text-xs rounded px-2 py-1 transition-colors ${
                    selectedTicker === etf.ticker
                      ? "bg-[var(--border)]"
                      : "hover:bg-[var(--border)]/50"
                  }`}
                >
                  <span className="font-mono font-bold">
                    {etf.market === "US" ? "$" : ""}{etf.ticker}
                  </span>
                  <span className="text-[var(--text-secondary)] truncate">
                    {etf.name}
                  </span>
                </button>
              ))}
              {sector.etfs.length === 0 && (
                <p className="text-xs text-[var(--text-secondary)]">
                  暂无 ETF 推荐
                </p>
              )}
            </div>
            {sector.recentOpinions.length > 0 && (
              <div className="mt-3 pt-2 border-t border-[var(--border)] space-y-1">
                {sector.recentOpinions.slice(0, 2).map((opinion) => (
                  <a
                    key={opinion.id}
                    href={opinion.post.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block text-xs hover:text-[var(--accent)]"
                    title={opinion.post.content}
                  >
                    <span
                      className="inline-block w-2 h-2 rounded-full mr-1"
                      style={{ backgroundColor: opinion.post.blogger.color }}
                    />
                    @{opinion.post.blogger.xUsername}{" "}
                    <span
                      className={
                        opinion.sentiment === "bullish"
                          ? "text-red-600"
                          : opinion.sentiment === "bearish"
                            ? "text-green-600"
                            : "text-[var(--text-secondary)]"
                      }
                    >
                      {opinion.sentiment === "bullish"
                        ? "看多"
                        : opinion.sentiment === "bearish"
                          ? "看空"
                          : "倾向未知"}
                    </span>
                    <span className="text-[var(--text-secondary)]">
                      {" "}· {opinion.confidence >= 0.7 ? "直接" : "弱关联"}
                    </span>
                  </a>
                ))}
              </div>
            )}
          </div>
        ))}

        {ranked.length === 0 && (
          <p className="text-xs text-[var(--text-secondary)] py-4">
            暂无板块配置
          </p>
        )}
      </div>
    </div>
  );
}
