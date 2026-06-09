"use client";

import { useState, useEffect, useCallback } from "react";
import MarketSwitcher from "@/components/MarketSwitcher";
import TabNav from "@/components/TabNav";
import SignalOverview from "@/components/SignalOverview";
import BloggerLibrary from "@/components/BloggerLibrary";
import WatchlistPanel from "@/components/WatchlistPanel";
import PriceChart from "@/components/PriceChart";
import PostTimeline from "@/components/PostTimeline";
import { useMarket } from "@/lib/market-context";

export default function Dashboard() {
  const { market } = useMarket();
  const [activeTab, setActiveTab] = useState("overview");
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [selectedBlogger, setSelectedBlogger] = useState<string | null>(null);
  const [highlightPostId, setHighlightPostId] = useState<string | null>(null);

  // Read ticker from URL on first load
  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const tickerParam = params.get("ticker");
      if (tickerParam) {
        setSelectedTicker(tickerParam);
      }
    }
  }, []);

  const handleSelectTicker = useCallback(
    (ticker: string | null) => {
      setSelectedTicker(ticker);
      setHighlightPostId(null);
    },
    []
  );

  const handleMentionClick = useCallback((postId: string) => {
    setHighlightPostId(postId);
    setTimeout(() => setHighlightPostId(null), 3000);
  }, []);

  return (
    <div className="min-h-screen flex flex-col">
      {/* Top bar */}
      <header className="border-b border-[var(--border-soft)] bg-[var(--card-bg)]">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div>
            <h1 className="font-serif-title text-base">
              Stock Signal Ledger
            </h1>
            <p className="text-xs text-[var(--text-secondary)]">
              多源博主信号追踪 · 板块情绪分析
            </p>
          </div>
          <MarketSwitcher />
        </div>
      </header>

      {/* Tab nav */}
      <div className="max-w-6xl mx-auto px-4 pt-4">
        <TabNav active={activeTab} onChange={setActiveTab} />
      </div>

      {/* Chart panel — shown when a ticker is selected */}
      {selectedTicker && (
        <div className="max-w-6xl mx-auto px-4 pt-4 w-full">
          <div className="bg-[var(--card-bg)] border border-[var(--border-soft)] rounded-xl p-4 shadow-sm mb-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-serif-title text-sm">
                {selectedTicker} · K 线图
              </h2>
              <button
                onClick={() => setSelectedTicker(null)}
                className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
              >
                关闭 ✕
              </button>
            </div>
            <PriceChart
              market={market}
              ticker={selectedTicker}
              selectedBlogger={selectedBlogger}
              onMentionClick={handleMentionClick}
            />
          </div>
          <div className="bg-[var(--card-bg)] border border-[var(--border-soft)] rounded-xl p-4 shadow-sm mb-4">
            <PostTimeline
              market={market}
              ticker={selectedTicker}
              selectedBlogger={selectedBlogger}
              highlightPostId={highlightPostId}
            />
          </div>
        </div>
      )}

      {/* Content */}
      <main className="flex-1 max-w-6xl mx-auto px-4 pb-8 w-full">
        {activeTab === "overview" && (
          <SignalOverview onSelectTicker={handleSelectTicker} />
        )}
        {activeTab === "bloggers" && <BloggerLibrary />}
        {activeTab === "watchlist" && <WatchlistPanel />}
      </main>
    </div>
  );
}
