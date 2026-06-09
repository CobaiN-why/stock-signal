"use client";

import { useState, useEffect, useCallback } from "react";
import { useMarket } from "@/lib/market-context";
import {
  getWatchlist,
  addSector,
  removeSector,
  addBlogger,
  removeBlogger,
} from "@/lib/watchlist-store";
import SentimentLight from "./SentimentLight";

interface SectorItem {
  slug: string;
  name: string;
  signalStrength: number;
  mentionCount: number;
}

interface BloggerItem {
  xUsername: string;
  displayName: string;
  color: string;
  score: number;
  lastOpinion: string | null;
}

export default function WatchlistPanel() {
  const { market } = useMarket();
  const [sectors, setSectors] = useState<SectorItem[]>([]);
  const [bloggers, setBloggers] = useState<BloggerItem[]>([]);
  const [followedSectors, setFollowedSectors] = useState<string[]>([]);
  const [followedBloggers, setFollowedBloggers] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [addMode, setAddMode] = useState<"sector" | "blogger" | null>(null);
  const [searchResults, setSearchResults] = useState<
    { id: string; name: string; slug?: string; xUsername?: string; color?: string }[]
  >([]);

  const loadWatchlist = useCallback(() => {
    const wl = getWatchlist();
    setFollowedSectors(wl.sectorSlugs);
    setFollowedBloggers(wl.bloggerUsernames);
  }, []);

  useEffect(() => {
    setLoading(true);
    loadWatchlist();

    // Fetch followed sectors' sentiment overview
    fetch(`/api/sectors/overview?market=${market}&days=30`)
      .then((r) => r.json())
      .then((data) => {
        const allSectors: SectorItem[] = (data.sectors ?? []).map(
          (s: { slug: string; name: string; signalStrength: number; mentionCount: number }) => ({
            slug: s.slug,
            name: s.name,
            signalStrength: s.signalStrength,
            mentionCount: s.mentionCount,
          })
        );
        setSectors(allSectors);
      })
      .catch(console.error);

    // Fetch all bloggers for follow management
    fetch(`/api/bloggers/with-credibility?market=${market}`)
      .then((r) => r.json())
      .then((data) => {
        const allBloggers: BloggerItem[] = (data ?? []).map(
          (b: { xUsername: string; displayName: string; color: string; credibility: { score: number }; lastActiveAt: string | null }) => ({
            xUsername: b.xUsername,
            displayName: b.displayName,
            color: b.color,
            score: b.credibility?.score ?? 0,
            lastOpinion: b.lastActiveAt,
          })
        );
        setBloggers(allBloggers);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [market, loadWatchlist]);

  const followedSectorItems = sectors.filter((s) =>
    followedSectors.includes(s.slug)
  );
  const followedBloggerItems = bloggers.filter((b) =>
    followedBloggers.includes(b.xUsername)
  );

  // Recent activity feed (placeholder)
  const recentActivity: { type: string; text: string; time: string }[] = [];

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-[var(--text-secondary)]">
        加载中...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Followed sections */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Followed sectors */}
        <div className="bg-[var(--card-bg)] border border-[var(--border-soft)] rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-serif-title text-sm">关注的板块</h3>
            <button
              onClick={() => {
                setAddMode("sector");
                setSearchResults(
                  sectors
                    .filter((s) => !followedSectors.includes(s.slug))
                    .map((s) => ({ id: s.slug, name: s.name, slug: s.slug }))
                );
              }}
              className="text-xs text-[var(--accent-green)] hover:underline"
            >
              + 添加
            </button>
          </div>
          {followedSectorItems.length === 0 ? (
            <p className="text-xs text-[var(--text-secondary)] py-4">
              暂未关注任何板块。点击「+ 添加」开始关注。
            </p>
          ) : (
            <div className="space-y-2">
              {followedSectorItems.map((s) => (
                <div
                  key={s.slug}
                  className="flex items-center justify-between p-2 rounded-lg bg-[var(--bg-warm-light)]"
                >
                  <div className="flex items-center gap-2">
                    <SentimentLight
                      signalStrength={s.signalStrength}
                      size="sm"
                    />
                    <span className="text-sm text-[var(--text-primary)]">
                      {s.name}
                    </span>
                    <span className="text-xs text-[var(--text-secondary)]">
                      {s.mentionCount} 条新观点
                    </span>
                  </div>
                  <button
                    onClick={() => {
                      removeSector(s.slug);
                      loadWatchlist();
                    }}
                    className="text-xs text-red-400 hover:text-red-500"
                  >
                    取消
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Followed bloggers */}
        <div className="bg-[var(--card-bg)] border border-[var(--border-soft)] rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-serif-title text-sm">关注的博主</h3>
            <button
              onClick={() => {
                setAddMode("blogger");
                setSearchResults(
                  bloggers
                    .filter(
                      (b) => !followedBloggers.includes(b.xUsername)
                    )
                    .map((b) => ({
                      id: b.xUsername,
                      name: b.displayName,
                      xUsername: b.xUsername,
                      color: b.color,
                    }))
                );
              }}
              className="text-xs text-[var(--accent-green)] hover:underline"
            >
              + 添加
            </button>
          </div>
          {followedBloggerItems.length === 0 ? (
            <p className="text-xs text-[var(--text-secondary)] py-4">
              暂未关注任何博主。点击「+ 添加」开始关注。
            </p>
          ) : (
            <div className="space-y-2">
              {followedBloggerItems.map((b) => (
                <div
                  key={b.xUsername}
                  className="flex items-center justify-between p-2 rounded-lg bg-[var(--bg-warm-light)]"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="w-6 h-6 rounded-full"
                      style={{ backgroundColor: b.color }}
                    />
                    <span className="text-sm text-[var(--text-primary)]">
                      {b.displayName}
                    </span>
                    <span className="text-xs text-[var(--text-secondary)] font-mono">
                      @{b.xUsername}
                    </span>
                  </div>
                  <button
                    onClick={() => {
                      removeBlogger(b.xUsername);
                      loadWatchlist();
                    }}
                    className="text-xs text-red-400 hover:text-red-500"
                  >
                    取消
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Add modal */}
      {addMode && (
        <div className="bg-[var(--card-bg)] border border-[var(--border-soft)] rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-medium">
              {addMode === "sector" ? "添加板块关注" : "添加博主关注"}
            </h4>
            <button
              onClick={() => setAddMode(null)}
              className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              关闭
            </button>
          </div>
          <div className="space-y-1 max-h-60 overflow-y-auto">
            {searchResults.length === 0 && (
              <p className="text-xs text-[var(--text-secondary)] py-2">
                没有可添加的项
              </p>
            )}
            {searchResults.map((item) => (
              <button
                key={item.id}
                onClick={() => {
                  if (addMode === "sector" && item.slug) {
                    addSector(item.slug);
                  } else if (addMode === "blogger" && item.xUsername) {
                    addBlogger(item.xUsername);
                  }
                  loadWatchlist();
                  setAddMode(null);
                }}
                className="w-full text-left flex items-center gap-2 p-2 rounded hover:bg-[var(--bg-warm-light)] text-sm transition-colors"
              >
                {item.color && (
                  <span
                    className="w-4 h-4 rounded-full"
                    style={{ backgroundColor: item.color }}
                  />
                )}
                <span className="text-[var(--text-primary)]">
                  {item.name}
                </span>
                {item.xUsername && (
                  <span className="text-xs text-[var(--text-secondary)] font-mono">
                    @{item.xUsername}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Smart tip */}
      {followedSectorItems.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <h4 className="text-xs font-medium text-amber-700 mb-1">
            💡 智能提示
          </h4>
          {followedSectorItems.filter((s) => s.signalStrength >= 65)
            .length > 0 && (
            <p className="text-xs text-amber-600">
              ⚡ 你关注的「
              {followedSectorItems
                .filter((s) => s.signalStrength >= 65)
                .map((s) => s.name)
                .join("、")}
              」板块有较强看多信号，建议关注。
            </p>
          )}
          {followedSectorItems.filter((s) => s.signalStrength <= 35)
            .length > 0 && (
            <p className="text-xs text-amber-600">
              ⚠️ 你关注的「
              {followedSectorItems
                .filter((s) => s.signalStrength <= 35)
                .map((s) => s.name)
                .join("、")}
              」板块有看空信号，注意风险。
            </p>
          )}
          {followedSectorItems.filter(
            (s) => s.signalStrength > 35 && s.signalStrength < 65
          ).length === followedSectorItems.length &&
            followedSectorItems.length > 0 && (
              <p className="text-xs text-amber-600">
                你关注的板块目前信号偏中性，继续观察。
              </p>
            )}
        </div>
      )}

      {/* Activity feed placeholder */}
      {recentActivity.length > 0 && (
        <div>
          <h3 className="font-serif-title text-sm mb-3">关注动态</h3>
          <div className="space-y-2">
            {recentActivity.map((a, i) => (
              <div
                key={i}
                className="p-2 rounded-lg bg-[var(--card-bg)] border border-[var(--border-soft)] text-sm"
              >
                <span className="text-[var(--text-secondary)]">
                  {a.time}
                </span>{" "}
                {a.text}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Notification settings placeholder */}
      <div className="bg-[var(--card-bg)] border border-[var(--border-soft)] rounded-xl p-4">
        <h3 className="font-serif-title text-sm mb-2">通知设置</h3>
        <div className="flex flex-col gap-2 text-sm">
          <label className="flex items-center gap-2 text-[var(--text-secondary)] cursor-not-allowed">
            <input type="checkbox" disabled className="opacity-50" />
            🔔 浏览器推送通知 (即将上线)
          </label>
          <label className="flex items-center gap-2 text-[var(--text-secondary)] cursor-not-allowed">
            <input type="checkbox" disabled className="opacity-50" />
            💬 微信服务通知 (小程序版即将上线)
          </label>
        </div>
      </div>
    </div>
  );
}
