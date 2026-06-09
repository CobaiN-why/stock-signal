"use client";

import { useState, useEffect, useMemo } from "react";
import { useMarket } from "@/lib/market-context";
import CredibilityBadge from "./CredibilityBadge";
import BloggerDetail from "./BloggerDetail";

interface BloggerSummary {
  id: string;
  xUsername: string;
  displayName: string;
  color: string;
  avatarUrl: string | null;
  credibility: {
    score: number;
    label: "高" | "中" | "低";
    accuracyRate: number | null;
    totalPredictions: number;
    correctPredictions: number;
  };
  topSectors: { slug: string; name: string; score: number }[];
  totalPosts: number;
  recentPostCount: number;
  lastActiveAt: string | null;
}

export default function BloggerLibrary() {
  const { market } = useMarket();
  const [bloggers, setBloggers] = useState<BloggerSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sectorFilter, setSectorFilter] = useState<string>("");
  const [selectedBlogger, setSelectedBlogger] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setSelectedBlogger(null);
    fetch(`/api/bloggers/with-credibility?market=${market}`)
      .then((r) => r.json())
      .then((data) => setBloggers(data ?? []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [market]);

  // Collect all unique sector slugs for the filter dropdown
  const allSectors = useMemo(() => {
    const slugs = new Set<string>();
    bloggers.forEach((b) =>
      b.topSectors.forEach((s) => slugs.add(s.slug))
    );
    return Array.from(slugs).sort();
  }, [bloggers]);

  const filtered = useMemo(() => {
    return bloggers.filter((b) => {
      if (search) {
        const q = search.toLowerCase();
        const matchName =
          b.displayName.toLowerCase().includes(q) ||
          b.xUsername.toLowerCase().includes(q);
        if (!matchName) return false;
      }
      if (sectorFilter) {
        if (!b.topSectors.some((s) => s.slug === sectorFilter)) return false;
      }
      return true;
    });
  }, [bloggers, search, sectorFilter]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-[var(--text-secondary)]">
        加载中...
      </div>
    );
  }

  return (
    <div>
      {/* Search + filter bar */}
      <div className="flex items-center gap-3 mb-6">
        <input
          type="text"
          placeholder="搜索博主名称或用户名..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 px-3 py-2 rounded-lg border border-[var(--border-soft)] bg-[var(--card-bg)] text-sm placeholder:text-[var(--text-secondary)] focus:outline-none focus:border-[var(--accent-green)]/50"
        />
        <select
          value={sectorFilter}
          onChange={(e) => setSectorFilter(e.target.value)}
          className="px-3 py-2 rounded-lg border border-[var(--border-soft)] bg-[var(--card-bg)] text-sm text-[var(--text-primary)]"
        >
          <option value="">全部板块</option>
          {allSectors.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      {/* Stats bar */}
      <div className="text-xs text-[var(--text-secondary)] mb-4">
        共 {bloggers.length} 位博主 ·{" "}
        {bloggers.filter((b) => b.credibility.label === "高").length} 位高可信
        · 筛选显示 {filtered.length} 位
      </div>

      {/* Blogger list */}
      <div className="space-y-3">
        {filtered.length === 0 && (
          <p className="text-[var(--text-secondary)] text-sm py-8 text-center">
            {bloggers.length === 0
              ? "暂无博主数据"
              : "无匹配博主"}
          </p>
        )}
        {filtered.map((blogger, i) => (
          <button
            key={blogger.id}
            onClick={() =>
              setSelectedBlogger(
                selectedBlogger === blogger.xUsername
                  ? null
                  : blogger.xUsername
              )
            }
            className={`w-full text-left p-4 rounded-xl border transition-all duration-200 bg-[var(--card-bg)] border-[var(--border-soft)] hover:border-[var(--accent-green)]/30 hover:shadow-sm ${
              selectedBlogger === blogger.xUsername
                ? "border-[var(--accent-green)]/50 shadow-md"
                : ""
            }`}
          >
            <div className="flex items-center gap-4">
              {/* Rank */}
              <span className="text-sm font-mono text-[var(--text-secondary)] w-6 shrink-0">
                #{i + 1}
              </span>

              {/* Avatar */}
              <span
                className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm shrink-0"
                style={{ backgroundColor: blogger.color }}
              >
                {blogger.displayName.slice(0, 1)}
              </span>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-[var(--text-primary)]">
                    {blogger.displayName}
                  </span>
                  <span className="text-xs text-[var(--text-secondary)] font-mono">
                    @{blogger.xUsername}
                  </span>
                  <CredibilityBadge
                    score={blogger.credibility.score}
                    label={blogger.credibility.label}
                  />
                </div>

                {/* Sector tags */}
                {blogger.topSectors.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {blogger.topSectors.map((s) => (
                      <span
                        key={s.slug}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[var(--bg-warm-light)] text-xs"
                      >
                        <span>{s.name}</span>
                        <span className="font-mono text-[var(--text-secondary)]">
                          {s.score}
                        </span>
                      </span>
                    ))}
                  </div>
                )}

                {/* Stats row */}
                <div className="flex items-center gap-4 mt-1.5 text-xs text-[var(--text-secondary)]">
                  <span>
                    {blogger.credibility.totalPredictions} 条预测
                  </span>
                  {blogger.credibility.accuracyRate !== null && (
                    <span>
                      准确率 {blogger.credibility.accuracyRate}%
                    </span>
                  )}
                  <span>近30天 {blogger.recentPostCount} 帖</span>
                  {blogger.lastActiveAt && (
                    <span>
                      {timeAgo(new Date(blogger.lastActiveAt))}
                    </span>
                  )}
                </div>
              </div>

              <span className="text-[var(--text-secondary)] text-lg">
                ›
              </span>
            </div>
          </button>
        ))}
      </div>

      {/* Blogger detail */}
      {selectedBlogger && (
        <div className="mt-6">
          <BloggerDetail
            username={selectedBlogger}
            onClose={() => setSelectedBlogger(null)}
          />
        </div>
      )}
    </div>
  );
}

function timeAgo(date: Date): string {
  const minutes = Math.floor((Date.now() - date.getTime()) / 60000);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return date.toLocaleDateString("zh-CN");
}
