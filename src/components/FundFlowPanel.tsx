"use client";

import { useState, useEffect } from "react";

interface FlowItem {
  name: string;
  netFlow: number;
  changePct: number;
  inflow: number;
  outflow: number;
  leadStock: string;
}

interface FundFlowData {
  timestamp: string;
  topInflow: FlowItem[];
  topOutflow: FlowItem[];
}

export default function FundFlowPanel() {
  const [data, setData] = useState<FundFlowData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch("/api/market/fund-flow?market=CN")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error);
        else setData(d);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-4 text-center text-sm text-[var(--text-secondary)]">
        加载资金流向...
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-4 text-center text-sm text-[var(--text-secondary)]">
        资金流向数据暂不可用
      </div>
    );
  }

  if (!data) return null;

  const maxAbsFlow = Math.max(
    ...data.topInflow.map((i) => Math.abs(i.netFlow)),
    ...data.topOutflow.map((i) => Math.abs(i.netFlow)),
    1
  );

  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-serif-title text-sm">主力资金流向</h3>
        <span className="text-xs text-[var(--text-secondary)]">
          {data.timestamp}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Top Inflow */}
        <div>
          <h4 className="text-xs font-medium text-red-500 mb-2">
            🔴 资金流入 Top 10
          </h4>
          <div className="space-y-1">
            {data.topInflow.map((item) => (
              <div key={item.name} className="flex items-center gap-2 text-xs">
                <span className="w-20 truncate text-[var(--text-primary)]">
                  {item.name}
                </span>
                <div className="flex-1 h-4 bg-[var(--bg-hover)] rounded overflow-hidden">
                  <div
                    className="h-full bg-red-400 rounded-r transition-all"
                    style={{
                      width: `${Math.min((Math.abs(item.netFlow) / maxAbsFlow) * 100, 100)}%`,
                    }}
                  />
                </div>
                <span className="w-14 text-right font-mono text-red-500">
                  +{item.netFlow.toFixed(1)}亿
                </span>
                <span className="w-8 text-right text-[var(--text-muted)]">
                  {item.changePct > 0 ? "+" : ""}
                  {item.changePct}%
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Top Outflow */}
        <div>
          <h4 className="text-xs font-medium text-green-500 mb-2">
            🟢 资金流出 Top 10
          </h4>
          <div className="space-y-1">
            {data.topOutflow.map((item) => (
              <div key={item.name} className="flex items-center gap-2 text-xs">
                <span className="w-20 truncate text-[var(--text-primary)]">
                  {item.name}
                </span>
                <div className="flex-1 h-4 bg-[var(--bg-hover)] rounded overflow-hidden">
                  <div
                    className="h-full bg-green-400 rounded-r transition-all"
                    style={{
                      width: `${Math.min((Math.abs(item.netFlow) / maxAbsFlow) * 100, 100)}%`,
                    }}
                  />
                </div>
                <span className="w-14 text-right font-mono text-green-500">
                  {item.netFlow.toFixed(1)}亿
                </span>
                <span className="w-8 text-right text-[var(--text-muted)]">
                  {item.changePct > 0 ? "+" : ""}
                  {item.changePct}%
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
