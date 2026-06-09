"use client";

import { useState, useEffect } from "react";
import { useMarket } from "@/lib/market-context";
import CredibilityBadge from "./CredibilityBadge";
import TagCloud from "./TagCloud";
import BacktestVerdict from "./BacktestVerdict";

interface BloggerData {
  id: string;
  xUsername: string;
  displayName: string;
  color: string;
  avatarUrl: string | null;
  credibility: {
    score: number;
    label: "高" | "中" | "低";
    totalPredictions: number;
    correctPredictions: number;
    sectorCount: number;
  };
  stats: {
    totalPosts: number;
    recentPostCount: number;
    totalOpinions: number;
    verifiedOpinions: number;
    lastActiveAt: string | null;
  };
  sectorCloud: {
    slug: string;
    name: string;
    score: number;
    label: "高" | "中" | "低";
    totalPredictions: number;
    correctPredictions: number;
    accuracyRate: number | null;
  }[];
}

interface Opinion {
  id: string;
  sentiment: string | null;
  confidence: number;
  evidence: string;
  post: {
    id: string;
    content: string;
    postedAt: string;
    url: string;
  };
  sector: {
    slug: string;
    name: string;
    primaryEtf: { ticker: string; market: string } | null;
  };
  backtest: {
    result: string;
    returnPct: number;
    windowDays: number;
    priceBefore: number;
    priceAfter: number;
  } | null;
}

interface Props {
  username: string;
  onClose: () => void;
}

export default function BloggerDetail({ username, onClose }: Props) {
  const { market } = useMarket();
  const [data, setData] = useState<BloggerData | null>(null);
  const [opinions, setOpinions] = useState<Opinion[]>([]);
  const [opinionTotal, setOpinionTotal] = useState(0);
  const [sectorFilter, setSectorFilter] = useState("");
  const [opinionOffset, setOpinionOffset] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setOpinionOffset(0);
    Promise.all([
      fetch(`/api/bloggers/${username}?market=${market}`).then((r) =>
        r.json()
      ),
      fetch(
        `/api/bloggers/${username}/opinions?market=${market}&limit=10&offset=0`
      ).then((r) => r.json()),
    ])
      .then(([profileData, opinionData]) => {
        setData(profileData);
        setOpinions(opinionData.opinions ?? []);
        setOpinionTotal(opinionData.total ?? 0);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [username, market]);

  // Load more opinions
  function loadMore() {
    const nextOffset = opinionOffset + 10;
    fetch(
      `/api/bloggers/${username}/opinions?market=${market}&limit=10&offset=${nextOffset}${
        sectorFilter ? `&sector=${sectorFilter}` : ""
      }`
    )
      .then((r) => r.json())
      .then((data) => {
        setOpinions((prev) => [...prev, ...(data.opinions ?? [])]);
        setOpinionOffset(nextOffset);
      })
      .catch(console.error);
  }

  // Filter by sector
  function handleSectorFilter(slug: string) {
    setSectorFilter(slug);
    setOpinionOffset(0);
    const url = `/api/bloggers/${username}/opinions?market=${market}&limit=10&offset=0${
      slug ? `&sector=${slug}` : ""
    }`;
    fetch(url)
      .then((r) => r.json())
      .then((data) => {
        setOpinions(data.opinions ?? []);
        setOpinionTotal(data.total ?? 0);
      })
      .catch(console.error);
  }

  if (loading) {
    return (
      <div className="bg-[var(--card-bg)] border border-[var(--border-soft)] rounded-xl p-6 text-center text-[var(--text-secondary)]">
        加载中...
      </div>
    );
  }

  if (!data) {
    return (
      <div className="bg-[var(--card-bg)] border border-[var(--border-soft)] rounded-xl p-6 text-center text-[var(--text-secondary)]">
        博主不存在
      </div>
    );
  }

  return (
    <div className="bg-[var(--card-bg)] border border-[var(--accent-green)]/30 rounded-xl p-6 shadow-md">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
          >
            ← 返回
          </button>
          <span
            className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold"
            style={{ backgroundColor: data.color }}
          >
            {data.displayName.slice(0, 1)}
          </span>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-[var(--text-primary)]">
                {data.displayName}
              </span>
              <span className="text-xs text-[var(--text-secondary)] font-mono">
                @{data.xUsername}
              </span>
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <CredibilityBadge
                score={data.credibility.score}
                label={data.credibility.label}
              />
              <span className="text-xs text-[var(--text-secondary)]">
                {data.credibility.totalPredictions} 条预测 ·{" "}
                {data.credibility.sectorCount} 个板块
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        <StatBox label="历史帖子" value={String(data.stats.totalPosts)} />
        <StatBox label="历史观点" value={String(data.stats.totalOpinions)} />
        <StatBox
          label="已验证"
          value={`${data.stats.verifiedOpinions}/${data.stats.totalOpinions}`}
        />
        <StatBox
          label="近30天"
          value={String(data.stats.recentPostCount)}
        />
      </div>

      {/* Sector tag cloud */}
      <div className="mb-6">
        <h4 className="text-xs font-medium text-[var(--text-secondary)] mb-2">
          擅长板块
        </h4>
        <TagCloud
          tags={data.sectorCloud.map((s) => ({
            slug: s.slug,
            name: s.name,
            score: s.score,
            totalPredictions: s.totalPredictions,
          }))}
        />
      </div>

      {/* Per-sector credibility breakdown */}
      {data.sectorCloud.length > 0 && (
        <div className="mb-6">
          <h4 className="text-xs font-medium text-[var(--text-secondary)] mb-2">
            分板块可信度
          </h4>
          <div className="space-y-1.5">
            {data.sectorCloud.map((s) => (
              <div
                key={s.slug}
                className="flex items-center gap-3 text-sm"
              >
                <span className="w-20 text-xs text-[var(--text-primary)] truncate">
                  {s.name}
                </span>
                <div className="flex-1 h-2 rounded-full bg-[var(--border-soft)] overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      s.score >= 70
                        ? "bg-emerald-400"
                        : s.score >= 40
                          ? "bg-amber-400"
                          : "bg-gray-300"
                    }`}
                    style={{ width: `${s.score}%` }}
                  />
                </div>
                <span className="w-12 text-right text-xs font-mono text-[var(--text-secondary)]">
                  {s.score}
                </span>
                <span className="w-16 text-right text-xs text-[var(--text-secondary)]">
                  {s.totalPredictions}条
                  {s.accuracyRate !== null &&
                    ` · ${Math.round(s.accuracyRate * 100)}%`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Opinion history */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-xs font-medium text-[var(--text-secondary)]">
            近期观点 ({opinionTotal})
          </h4>
          <select
            value={sectorFilter}
            onChange={(e) => handleSectorFilter(e.target.value)}
            className="text-xs px-2 py-1 rounded border border-[var(--border-soft)] bg-[var(--bg-warm-light)]"
          >
            <option value="">全部板块</option>
            {data.sectorCloud.map((s) => (
              <option key={s.slug} value={s.slug}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2 max-h-96 overflow-y-auto">
          {opinions.length === 0 && (
            <p className="text-xs text-[var(--text-secondary)] py-4 text-center">
              暂无观点数据
            </p>
          )}
          {opinions.map((op) => (
            <div
              key={op.id}
              className="p-3 rounded-lg bg-[var(--bg-warm-light)] text-sm"
            >
              <div className="flex items-center gap-2 mb-1">
                <span
                  className={`text-xs font-medium ${
                    op.sentiment === "bullish"
                      ? "text-red-500"
                      : op.sentiment === "bearish"
                        ? "text-green-500"
                        : "text-[var(--text-secondary)]"
                  }`}
                >
                  {op.sentiment === "bullish"
                    ? "看多"
                    : op.sentiment === "bearish"
                      ? "看空"
                      : "未知"}
                </span>
                <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--border-soft)]/50">
                  {op.sector.name}
                </span>
                {op.sector.primaryEtf && (
                  <span className="text-xs text-[var(--text-secondary)] font-mono">
                    → {op.sector.primaryEtf.ticker}
                  </span>
                )}
                {op.backtest && (
                  <BacktestVerdict
                    result={op.backtest.result}
                    returnPct={op.backtest.returnPct}
                  />
                )}
                {!op.backtest && op.sentiment && (
                  <span className="text-xs text-[var(--text-secondary)]">
                    ⏳ 待验证
                  </span>
                )}
              </div>
              <p className="text-xs text-[var(--text-secondary)] line-clamp-2">
                {op.post.content}
              </p>
              <div className="flex items-center gap-2 mt-1 text-xs text-[var(--text-secondary)]">
                <span>
                  {new Date(op.post.postedAt).toLocaleDateString("zh-CN")}
                </span>
                <a
                  href={op.post.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[var(--accent-green)] hover:underline"
                >
                  查看原帖 →
                </a>
              </div>
            </div>
          ))}
        </div>

        {opinions.length < opinionTotal && (
          <button
            onClick={loadMore}
            className="mt-3 w-full py-2 text-sm text-[var(--accent-green)] hover:bg-[var(--bg-warm-light)] rounded-lg transition-colors"
          >
            加载更多...
          </button>
        )}
      </div>
    </div>
  );
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[var(--bg-warm-light)] rounded-lg p-3 text-center">
      <div className="text-lg font-mono font-bold text-[var(--text-primary)]">
        {value}
      </div>
      <div className="text-xs text-[var(--text-secondary)]">{label}</div>
    </div>
  );
}
