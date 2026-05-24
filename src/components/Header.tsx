"use client";

import { useEffect, useState } from "react";

interface Stats {
  postCount: number;
  stockCount: number;
  bloggerCount: number;
  lastUpdated: string | null;
}

export default function Header() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    fetch("/api/stats")
      .then((r) => r.json())
      .then(setStats)
      .catch(() => {});
  }, []);

  const cards = [
    { label: "帖子入库", value: stats?.postCount ?? "—" },
    { label: "股票追踪", value: stats?.stockCount ?? "—" },
    { label: "博主追踪", value: stats?.bloggerCount ?? "—" },
    {
      label: "最新更新",
      value: stats?.lastUpdated
        ? new Date(stats.lastUpdated).toLocaleString("zh-CN", {
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
          })
        : "—",
    },
  ];

  return (
    <header className="px-6 pt-6 pb-4">
      <h1 className="font-serif-title text-3xl md:text-4xl text-[var(--text-primary)] mb-1">
        Stock Signal Ledger
      </h1>
      <p className="text-xs text-[var(--text-secondary)] mb-4 tracking-wider uppercase">
        X / Multi-Blogger Intelligence Archive
      </p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {cards.map((card) => (
          <div
            key={card.label}
            className="bg-[var(--card-bg)] border border-[var(--border-soft)] rounded-lg px-4 py-3 shadow-sm"
          >
            <div className="text-2xl font-mono font-bold">{card.value}</div>
            <div className="text-xs text-[var(--text-secondary)] mt-1">
              {card.label}
            </div>
          </div>
        ))}
      </div>
    </header>
  );
}
