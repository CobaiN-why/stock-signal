"use client";

import { useMarket } from "@/lib/market-context";
import type { Market } from "@/lib/markets";

const markets: { key: Market; label: string }[] = [
  { key: "US", label: "美股" },
  { key: "CN", label: "A股" },
];

export default function MarketSwitcher() {
  const { market, setMarket } = useMarket();

  return (
    <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-1 shadow-sm">
      {markets.map((item) => (
        <button
          key={item.key}
          onClick={() => setMarket(item.key)}
          className={`px-4 py-2 text-sm rounded-md transition-all duration-200 font-medium ${
            market === item.key
              ? "bg-[var(--text-primary)] text-white shadow-sm"
              : "text-[var(--text-secondary)] hover:bg-[var(--border)]/60"
          }`}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
