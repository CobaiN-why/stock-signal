"use client";

import { useEffect, useState } from "react";

interface Stock {
  id: string;
  ticker: string;
  companyName: string;
  latestPrice: string | null;
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

  return (
    <div>
      <h2 className="font-serif-title text-sm mb-3 text-[var(--text-secondary)]">
        Symbols
      </h2>
      <div className="flex gap-1 mb-3">
        {filters.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-3 py-1 rounded-full text-xs transition-colors ${
              filter === f.key
                ? "bg-[var(--accent-green)] text-white"
                : "bg-[var(--border-soft)] text-[var(--text-secondary)] hover:bg-[var(--border-soft)]/80"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>
      <div className="space-y-1 max-h-[400px] overflow-y-auto scrollbar-hide">
        {stocks.map((s) => (
          <button
            key={s.id}
            onClick={() => onSelect(s.ticker)}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-sm transition-colors ${
              selectedTicker === s.ticker
                ? "bg-[var(--border-soft)]"
                : "hover:bg-[var(--border-soft)]/50"
            }`}
          >
            <div>
              <span className="font-mono font-bold">{s.ticker}</span>
              <span className="ml-2 text-xs text-[var(--text-secondary)]">
                {s._count.postStocks} mentions
              </span>
            </div>
            <span className="font-mono text-sm">
              {s.latestPrice ? `$${Number(s.latestPrice).toFixed(2)}` : "—"}
            </span>
          </button>
        ))}
        {stocks.length === 0 && (
          <p className="text-xs text-[var(--text-secondary)] px-3">
            暂无数据
          </p>
        )}
      </div>
    </div>
  );
}
