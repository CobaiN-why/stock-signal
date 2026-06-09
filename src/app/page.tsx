"use client";

import { useState, useEffect, useCallback } from "react";
import MarketSwitcher from "@/components/MarketSwitcher";
import TabNav from "@/components/TabNav";
import SignalOverview from "@/components/SignalOverview";
import BloggerLibrary from "@/components/BloggerLibrary";
import WatchlistPanel from "@/components/WatchlistPanel";

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState("overview");

  // Read ticker from URL on first load
  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const tickerParam = params.get("ticker");
      if (tickerParam) {
        // Future: pre-select this ticker in the UI
      }
    }
  }, []);

  const handleTabChange = useCallback((tab: string) => {
    setActiveTab(tab);
  }, []);

  return (
    <div className="min-h-screen flex flex-col">
      {/* Top bar */}
      <header className="border-b border-[var(--border)] bg-[var(--bg-card)]">
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
        <TabNav active={activeTab} onChange={handleTabChange} />
      </div>

      {/* Content */}
      <main className="flex-1 max-w-6xl mx-auto px-4 pb-8 w-full">
        {activeTab === "overview" && <SignalOverview />}
        {activeTab === "bloggers" && <BloggerLibrary />}
        {activeTab === "watchlist" && <WatchlistPanel />}
      </main>
    </div>
  );
}
