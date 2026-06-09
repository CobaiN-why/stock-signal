"use client";

import { useState, useEffect } from "react";
import recommendedBloggers from "@/data/recommended-bloggers.json";

interface RecommendedUser {
  xUsername: string;
  displayName: string;
  description: string;
  followersCount: number;
  followingCount: number;
  tweetCount: number;
  avatarUrl: string | null;
  verified: boolean;
}

interface CuratedBlogger {
  xUsername: string;
  displayName: string;
  description: string;
  category: string;
  market: string;
  reason: string;
}

interface Props {
  onAdded: () => void;
}

const PRESET_QUERIES = [
  { label: "A股", query: "A股 股票" },
  { label: "美股", query: "US stocks investing" },
  { label: "港股/中概", query: "港股 中概 China stocks" },
  { label: "半导体", query: "semiconductor chip stocks" },
  { label: "量化", query: "量化 trading" },
];

interface ScoredUser extends RecommendedUser {
  score?: number;
  sharedBy?: number;
}

type TabType = "curated" | "search" | "network";

export default function BloggerRecommend({ onAdded }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [results, setResults] = useState<ScoredUser[]>([]);
  const [networkResults, setNetworkResults] = useState<ScoredUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingNetwork, setLoadingNetwork] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabType>("curated");
  const [addingUser, setAddingUser] = useState<string | null>(null);
  const [addedUsers, setAddedUsers] = useState<Set<string>>(new Set());

  // Group curated bloggers by category
  const curatedByCategory = (recommendedBloggers as CuratedBlogger[]).reduce(
    (acc, b) => {
      const cat = b.category || "其他";
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(b);
      return acc;
    },
    {} as Record<string, CuratedBlogger[]>
  );

  const handleNetworkMine = async () => {
    setLoadingNetwork(true);
    setError(null);
    try {
      const res = await fetch("/api/bloggers/recommend-by-network");
      const data = await res.json();
      if (data.error) setError(data.error);
      else setNetworkResults(data.recommended ?? []);
      setTab("network");
    } catch (e) {
      setError(String(e));
    } finally {
      setLoadingNetwork(false);
    }
  };

  const handleSearch = async (query: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/bloggers/recommend?query=${encodeURIComponent(query)}`
      );
      const data = await res.json();
      if (data.error) setError(data.error);
      else setResults(data.recommended ?? []);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = async (user: RecommendedUser) => {
    setAddingUser(user.xUsername);
    try {
      const colors = ["#2563eb", "#ef4444", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899", "#06b6d4", "#f97316"];
      const color = colors[Math.floor(Math.random() * colors.length)];

      const res = await fetch("/api/bloggers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          xUsername: user.xUsername,
          displayName: user.displayName,
          color,
        }),
      });

      if (res.ok) {
        setResults((prev) => prev.filter((u) => u.xUsername !== user.xUsername));
        onAdded();
      } else {
        const data = await res.json();
        setError(data.error ?? "添加失败");
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setAddingUser(null);
    }
  };

  const handleAddCurated = async (blogger: CuratedBlogger) => {
    setAddingUser(blogger.xUsername);
    try {
      const colors = ["#2563eb", "#ef4444", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899", "#06b6d4", "#f97316"];
      const color = colors[Math.floor(Math.random() * colors.length)];

      const res = await fetch("/api/bloggers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          xUsername: blogger.xUsername,
          displayName: blogger.displayName,
          color,
        }),
      });

      if (res.ok) {
        setAddedUsers((prev) => new Set(prev).add(blogger.xUsername));
        onAdded();
      } else {
        const data = await res.json();
        setError(data.error ?? "添加失败");
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setAddingUser(null);
    }
  };

  return (
    <div className="mb-6">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-sm font-medium text-[var(--accent)] hover:underline"
      >
        {expanded ? "▾" : "▸"} 推荐博主
        <span className="text-xs text-[var(--text-secondary)] font-normal">
          (发现新的投资博主)
        </span>
      </button>

      {expanded && (
        <div className="mt-3 p-4 bg-[var(--bg-hover)] border border-[var(--border)] rounded-xl">
          {/* Tab toggle */}
          <div className="flex gap-2 mb-3">
            <button
              onClick={() => setTab("curated")}
              className={`text-xs px-3 py-1 rounded-full border transition-colors ${
                tab === "curated"
                  ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]"
                  : "border-[var(--border)] bg-[var(--bg-card)]"
              }`}
            >
              ✨ 精选推荐
              <span className="ml-1 text-[var(--text-muted)]">({recommendedBloggers.length})</span>
            </button>
            <button
              onClick={() => setTab("search")}
              className={`text-xs px-3 py-1 rounded-full border transition-colors ${
                tab === "search"
                  ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]"
                  : "border-[var(--border)] bg-[var(--bg-card)]"
              }`}
            >
              关键词搜索
            </button>
            <button
              onClick={() => { setTab("network"); handleNetworkMine(); }}
              disabled={loadingNetwork}
              className={`text-xs px-3 py-1 rounded-full border transition-colors disabled:opacity-50 ${
                tab === "network"
                  ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]"
                  : "border-[var(--border)] bg-[var(--bg-card)]"
              }`}
            >
              {loadingNetwork ? "挖掘中..." : "🔗 关系网挖掘"}
              <span className="ml-1 text-[var(--text-muted)]">(共同关注)</span>
            </button>
          </div>

          {/* Curated picks */}
          {tab === "curated" && (
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {Object.entries(curatedByCategory).map(([category, bloggers]) => (
              <div key={category}>
                <div className="text-xs font-medium text-[var(--text-secondary)] mb-2 sticky top-0 bg-[var(--bg-hover)] py-1">
                  {category}
                </div>
                <div className="space-y-2">
                  {bloggers.map((blogger) => (
                    <div
                      key={blogger.xUsername}
                      className="flex items-start gap-3 p-2 rounded-lg bg-[var(--bg-card)] text-sm"
                    >
                      <span className="w-10 h-10 rounded-full bg-[var(--accent)]/10 flex items-center justify-center text-[var(--accent)] font-bold text-sm shrink-0 mt-0.5">
                        {blogger.displayName.slice(0, 2)}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium text-[var(--text-primary)]">
                            {blogger.displayName}
                          </span>
                          <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--accent)]/10 text-[var(--accent)] font-mono">
                            {blogger.market}
                          </span>
                        </div>
                        <a
                          href={`https://x.com/${blogger.xUsername}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-[var(--accent)] hover:underline font-mono"
                        >
                          @{blogger.xUsername} ↗
                        </a>
                        <p className="text-xs text-[var(--text-secondary)] mt-0.5 line-clamp-2">
                          {blogger.description}
                        </p>
                        <p className="text-xs text-amber-600 mt-0.5">
                          💡 {blogger.reason}
                        </p>
                      </div>
                      <button
                        onClick={() => handleAddCurated(blogger)}
                        disabled={
                          addingUser === blogger.xUsername ||
                          addedUsers.has(blogger.xUsername)
                        }
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-opacity shrink-0 ${
                          addedUsers.has(blogger.xUsername)
                            ? "bg-green-100 text-green-700"
                            : "bg-[var(--accent)] text-white hover:opacity-90"
                        } disabled:opacity-50`}
                      >
                        {addedUsers.has(blogger.xUsername)
                          ? "✓ 已添加"
                          : addingUser === blogger.xUsername
                            ? "添加中..."
                            : "+ 跟踪"}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          )}

          {/* Preset search buttons */}
          {tab === "search" && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {PRESET_QUERIES.map((q) => (
              <button
                key={q.label}
                onClick={() => handleSearch(q.query)}
                disabled={loading}
                className="px-3 py-1 text-xs rounded-full border border-[var(--border)] bg-[var(--bg-card)] hover:border-[var(--accent)]/50 transition-colors disabled:opacity-50"
              >
                {q.label}
              </button>
            ))}
          </div>
          )}

          {error && (
            <p className="text-xs text-red-500 mb-2">搜索失败: {error}</p>
          )}

          {loading && (
            <p className="text-xs text-[var(--text-secondary)] py-4 text-center">
              搜索中...
            </p>
          )}

          {/* Results — search or network */}
          {((tab === "search" && !loading && results.length > 0) ||
            (tab === "network" && !loadingNetwork && networkResults.length > 0)) && (
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {(tab === "search" ? results : networkResults).map((user) => (
                <div
                  key={user.xUsername}
                  className="flex items-center gap-3 p-2 rounded-lg bg-[var(--bg-card)] text-sm"
                >
                  <span className="w-10 h-10 rounded-full bg-[var(--accent)]/10 flex items-center justify-center text-[var(--accent)] font-bold text-sm shrink-0">
                    {user.displayName.slice(0, 1)}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1">
                      <span className="font-medium text-[var(--text-primary)]">
                        {user.displayName}
                      </span>
                      {user.verified && (
                        <span className="text-blue-400 text-xs">✓</span>
                      )}
                      {user.score !== undefined && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--accent)]/10 text-[var(--accent)] font-mono">
                          {user.score}分
                        </span>
                      )}
                      {user.sharedBy !== undefined && user.sharedBy > 1 && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">
                          {user.sharedBy}位共同关注
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-[var(--text-muted)] font-mono">
                      @{user.xUsername}
                    </p>
                    <p className="text-xs text-[var(--text-secondary)] line-clamp-1 mt-0.5">
                      {user.description || "无简介"}
                    </p>
                    <div className="flex items-center gap-3 mt-1 text-xs text-[var(--text-muted)]">
                      <span>{fmtCount(user.followersCount)} 粉丝</span>
                      <span>{fmtCount(user.tweetCount)} 推文</span>
                    </div>
                  </div>
                  <button
                    onClick={() => handleAdd(user)}
                    disabled={addingUser === user.xUsername}
                    className="px-3 py-1.5 rounded-lg bg-[var(--accent)] text-white text-xs font-medium hover:opacity-90 transition-opacity disabled:opacity-50 shrink-0"
                  >
                    {addingUser === user.xUsername ? "添加中..." : "+ 跟踪"}
                  </button>
                </div>
              ))}
            </div>
          )}

          {!loading && results.length === 0 && !error && (
            <p className="text-xs text-[var(--text-secondary)] py-2">
              点击上方标签搜索相关博主
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function fmtCount(n: number): string {
  if (n >= 10000) return (n / 10000).toFixed(1) + "万";
  if (n >= 1000) return (n / 1000).toFixed(1) + "k";
  return String(n);
}
