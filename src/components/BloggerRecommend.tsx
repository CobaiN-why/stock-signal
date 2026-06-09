"use client";

import { useState } from "react";

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

export default function BloggerRecommend({ onAdded }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [results, setResults] = useState<RecommendedUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addingUser, setAddingUser] = useState<string | null>(null);

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
          {/* Preset search buttons */}
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

          {error && (
            <p className="text-xs text-red-500 mb-2">搜索失败: {error}</p>
          )}

          {loading && (
            <p className="text-xs text-[var(--text-secondary)] py-4 text-center">
              搜索中...
            </p>
          )}

          {!loading && results.length > 0 && (
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {results.map((user) => (
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
