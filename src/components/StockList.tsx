"use client";

import { useEffect, useState } from "react";

interface Stock {
  id: string;
  ticker: string;
  companyName: string;
  latestPrice: string | null;
  lastMentionedAt: string | null;
  _count: { postStocks: number };
}

type Filter = "all" | "has_price" | "high_freq";

interface Props {
  selectedTicker: string | null;
  onSelect: (ticker: string) => void;
}

export default function StockList({ selectedTicker, onSelect }: Props) {
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetch(`/api/stocks?filter=${filter}`)
      .then((r) => r.json())
      .then(setStocks)
      .catch(() => {});
  }, [filter]);

  const filters: { key: Filter; label: string }[] = [
    { key: "all", label: "全部" },
    { key: "has_price", label: "有价格" },
    { key: "high_freq", label: "高频" },
  ];

  const filtered = search
    ? stocks.filter((s) =>
        s.ticker.toLowerCase().includes(search.toLowerCase()) ||
        s.companyName.toLowerCase().includes(search.toLowerCase())
      )
    : stocks;

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <h2 className="font-serif-title text-sm mb-3 text-[var(--text-secondary)]">
        Symbols
      </h2>

      {/* Search */}
      <div className="mb-3">
        <input
          type="text"
          placeholder="搜索 NVDA / TSM ..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--border-soft)] bg-[var(--bg-warm-light)] placeholder:text-[var(--text-secondary)]/60 focus:outline-none focus:ring-1 focus:ring-[var(--accent-green)]"
        />
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 mb-3">
        {filters.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-3 py-1 rounded-full text-xs transition-colors ${
              filter === f.key
                ? "bg-[var(--text-primary)] text-white"
                : "bg-[var(--border-soft)] text-[var(--text-secondary)] hover:bg-[var(--border-soft)]/80"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Stock list */}
      <div className="space-y-1 overflow-y-auto scrollbar-hide flex-1 min-h-0">
        {filtered.map((s) => (
          <button
            key={s.id}
            onClick={() => onSelect(s.ticker)}
            className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-left transition-colors ${
              selectedTicker === s.ticker
                ? "bg-[var(--border-soft)]"
                : "hover:bg-[var(--border-soft)]/50"
            }`}
          >
            <div className="min-w-0">
              <div className="font-mono font-bold text-base">${s.ticker}</div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-xs font-bold text-[var(--accent-green)]">
                  {s._count.postStocks} 次提及
                </span>
                {s.lastMentionedAt && (
                  <span className="text-xs text-[var(--text-secondary)]">
                    最新{" "}
                    {new Date(s.lastMentionedAt).toLocaleDateString("zh-CN", {
                      month: "2-digit",
                      day: "2-digit",
                    })}
                  </span>
                )}
              </div>
            </div>
            <span className="font-mono text-sm font-bold shrink-0 ml-2">
              {s.latestPrice ? `$${Number(s.latestPrice).toFixed(2)}` : "—"}
            </span>
          </button>
        ))}
        {filtered.length === 0 && (
          <p className="text-xs text-[var(--text-secondary)] px-3 py-4 text-center">
            暂无数据
          </p>
        )}
      </div>
    </div>
  );
}
