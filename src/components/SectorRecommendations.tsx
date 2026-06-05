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
  stockCount: number;
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
}

export default function SectorRecommendations({ market }: Props) {
  const [sectors, setSectors] = useState<Sector[]>([]);

  useEffect(() => {
    fetch(`/api/sectors?market=${market}`)
      .then((r) => r.json())
      .then((d) => setSectors(d.sectors || []))
      .catch(() => {});
  }, [market]);

  const ranked = [...sectors].sort((a, b) => b.mentionCount - a.mentionCount);

  return (
    <div className="bg-[var(--card-bg)] border border-[var(--border-soft)] rounded-lg p-4 shadow-sm">
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
            className="border border-[var(--border-soft)] rounded-lg p-3"
          >
            <div className="flex items-baseline gap-2 mb-1">
              <h3 className="text-sm font-bold">{sector.name}</h3>
              <span className="text-xs text-[var(--text-secondary)]">
                {sector.mentionCount} 次提及
              </span>
            </div>
            {sector.description && (
              <p className="text-xs text-[var(--text-secondary)] line-clamp-2 mb-2">
                {sector.description}
              </p>
            )}
            <div className="space-y-1">
              {sector.etfs.slice(0, 3).map((etf) => (
                <div
                  key={etf.ticker}
                  className="flex items-center justify-between gap-2 text-xs"
                >
                  <span className="font-mono font-bold">${etf.ticker}</span>
                  <span className="text-[var(--text-secondary)] truncate">
                    {etf.name}
                  </span>
                </div>
              ))}
              {sector.etfs.length === 0 && (
                <p className="text-xs text-[var(--text-secondary)]">
                  暂无 ETF 推荐
                </p>
              )}
            </div>
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
