"use client";

import { useEffect, useState } from "react";

interface StockProfile {
  shortName: string;
  longName: string;
  sector: string;
  industry: string;
  marketCap: number | null;
  pe: number | null;
  forwardPe: number | null;
  eps: number | null;
  dividendYield: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  avgVolume: number | null;
  description: string;
}

interface StockData {
  ticker: string;
  companyName: string;
  latestPrice: string | null;
  profile: StockProfile | null;
  analysis: string | null;
}

interface Props {
  ticker: string | null;
}

function formatMarketCap(n: number | null): string {
  if (!n) return "—";
  if (n >= 1e12) return `$${(n / 1e12).toFixed(1)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`;
  return `$${n.toLocaleString()}`;
}

function formatVolume(n: number | null): string {
  if (!n) return "—";
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return n.toLocaleString();
}

export default function StockInfo({ ticker }: Props) {
  const [data, setData] = useState<StockData | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!ticker) {
      setData(null);
      setExpanded(false);
      return;
    }
    setLoading(true);
    fetch(`/api/stocks/${ticker}`)
      .then((r) => r.json())
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [ticker]);

  if (!ticker) {
    return (
      <div className="bg-[var(--card-bg)] border border-[var(--border-soft)] rounded-lg p-4 shadow-sm text-sm text-[var(--text-secondary)] text-center py-8">
        选择股票后显示基本信息与分析
      </div>
    );
  }

  if (loading || !data) {
    return (
      <div className="bg-[var(--card-bg)] border border-[var(--border-soft)] rounded-lg p-4 shadow-sm text-sm text-[var(--text-secondary)] text-center py-8">
        加载中...
      </div>
    );
  }

  const p = data.profile;

  const metrics = [
    { label: "市值", value: formatMarketCap(p?.marketCap ?? null) },
    { label: "PE (TTM)", value: p?.pe?.toFixed(1) ?? "—" },
    { label: "Forward PE", value: p?.forwardPe?.toFixed(1) ?? "—" },
    { label: "EPS", value: p?.eps ? `$${p.eps.toFixed(2)}` : "—" },
    {
      label: "52W Range",
      value:
        p?.fiftyTwoWeekLow && p?.fiftyTwoWeekHigh
          ? `$${p.fiftyTwoWeekLow.toFixed(0)} - $${p.fiftyTwoWeekHigh.toFixed(0)}`
          : "—",
    },
    { label: "Avg Vol", value: formatVolume(p?.avgVolume ?? null) },
  ];

  return (
    <div className="bg-[var(--card-bg)] border border-[var(--border-soft)] rounded-lg p-4 shadow-sm">
      {/* Company header */}
      <div className="mb-4">
        <h3 className="font-serif-title text-lg">
          {p?.longName || p?.shortName || data.companyName || data.ticker}
        </h3>
        {p?.sector && (
          <p className="text-xs text-[var(--text-secondary)] mt-0.5">
            {p.sector} / {p.industry}
          </p>
        )}
      </div>

      {/* Key metrics grid */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-3 mb-4">
        {metrics.map((m) => (
          <div key={m.label}>
            <div className="text-xs text-[var(--text-secondary)]">
              {m.label}
            </div>
            <div className="font-mono text-sm font-bold">{m.value}</div>
          </div>
        ))}
      </div>

      {/* Company description */}
      {p?.description && (
        <p className="text-xs text-[var(--text-secondary)] leading-relaxed mb-4 line-clamp-2">
          {p.description}
        </p>
      )}

      {/* HV Analysis */}
      {data.analysis && (
        <div className="border-t border-[var(--border-soft)] pt-4">
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-2 text-sm font-bold text-[var(--accent-green)] hover:underline cursor-pointer"
          >
            <span>{expanded ? "▾" : "▸"}</span>
            纵横分析报告
          </button>
          {expanded && (
            <div className="mt-3 prose prose-sm max-w-none text-[var(--text-primary)]">
              <div
                className="text-sm leading-relaxed whitespace-pre-wrap"
                style={{ maxHeight: "500px", overflowY: "auto" }}
              >
                {data.analysis}
              </div>
            </div>
          )}
        </div>
      )}

      {!data.analysis && !p && (
        <p className="text-xs text-[var(--text-secondary)] text-center py-2">
          暂无基本面数据
        </p>
      )}
    </div>
  );
}
