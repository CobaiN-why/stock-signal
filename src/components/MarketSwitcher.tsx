"use client";

import type { Market } from "@/lib/markets";

interface Props {
  market: Market;
  onChange: (market: Market) => void;
}

const markets: { key: Market; label: string }[] = [
  { key: "US", label: "美股" },
  { key: "CN", label: "A股" },
];

export default function MarketSwitcher({ market, onChange }: Props) {
  return (
    <div className="inline-flex rounded-lg border border-[var(--border-soft)] bg-[var(--card-bg)] p-1">
      {markets.map((item) => (
        <button
          key={item.key}
          onClick={() => onChange(item.key)}
          className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
            market === item.key
              ? "bg-[var(--text-primary)] text-white"
              : "text-[var(--text-secondary)] hover:bg-[var(--border-soft)]/60"
          }`}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
