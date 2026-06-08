"use client";

import { useState, useCallback } from "react";
import Header from "@/components/Header";
import BloggerList from "@/components/BloggerList";
import StockList from "@/components/StockList";
import PriceChart from "@/components/PriceChart";
import StockInfo from "@/components/StockInfo";
import PostTimeline from "@/components/PostTimeline";
import MarketSwitcher from "@/components/MarketSwitcher";
import SignalEventList from "@/components/SignalEventList";
import SectorRecommendations from "@/components/SectorRecommendations";
import type { Market } from "@/lib/markets";

export default function Dashboard() {
  const [market, setMarket] = useState<Market>("CN");
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [selectedBlogger, setSelectedBlogger] = useState<string | null>(null);
  const [highlightPostId, setHighlightPostId] = useState<string | null>(null);

  const handleMentionClick = useCallback((postId: string) => {
    setHighlightPostId(postId);
    setTimeout(() => setHighlightPostId(null), 3000);
  }, []);

  const handleMarketChange = useCallback((nextMarket: Market) => {
    setMarket(nextMarket);
    setSelectedTicker(null);
    setSelectedBlogger(null);
    setHighlightPostId(null);
  }, []);

  return (
    <div className="min-h-screen flex flex-col">
      <Header market={market} />

      <div className="flex-1 flex px-6 gap-6 pb-6">
        {/* Left Sidebar — fixed height, internal scroll */}
        <aside className="w-[260px] shrink-0 hidden md:flex flex-col gap-4 sticky top-0 self-start max-h-screen pt-2">
          <div className="bg-[var(--card-bg)] border border-[var(--border-soft)] rounded-lg p-4 shadow-sm shrink-0">
            <BloggerList
              market={market}
              selectedBlogger={selectedBlogger}
              onSelect={setSelectedBlogger}
            />
          </div>
          <div className="bg-[var(--card-bg)] border border-[var(--border-soft)] rounded-lg p-4 shadow-sm flex-1 min-h-0 flex flex-col overflow-hidden">
            <StockList
              market={market}
              selectedTicker={selectedTicker}
              onSelect={setSelectedTicker}
            />
          </div>
        </aside>

        {/* Main Content — chart → analysis → timeline, scrollable page */}
        <main className="flex-1 min-w-0 space-y-6">
          <div className="flex justify-end">
            <MarketSwitcher market={market} onChange={handleMarketChange} />
          </div>

          <SignalEventList market={market} />

          <SectorRecommendations
            market={market}
            selectedTicker={selectedTicker}
            onSelectTicker={setSelectedTicker}
          />

          <div className="bg-[var(--card-bg)] border border-[var(--border-soft)] rounded-lg p-4 shadow-sm">
            <PriceChart
              market={market}
              ticker={selectedTicker}
              selectedBlogger={selectedBlogger}
              onMentionClick={handleMentionClick}
            />
          </div>

          <StockInfo market={market} ticker={selectedTicker} onMentionClick={handleMentionClick} />

          <div className="bg-[var(--card-bg)] border border-[var(--border-soft)] rounded-lg p-4 shadow-sm">
            <PostTimeline
              market={market}
              ticker={selectedTicker}
              selectedBlogger={selectedBlogger}
              highlightPostId={highlightPostId}
            />
          </div>
        </main>
      </div>

      {/* Mobile Sidebar */}
      <div className="md:hidden px-6 pb-4">
        <details className="bg-[var(--card-bg)] border border-[var(--border-soft)] rounded-lg p-4">
          <summary className="font-serif-title text-sm cursor-pointer">
            Bloggers & Symbols
          </summary>
          <div className="mt-3">
            <BloggerList
              market={market}
              selectedBlogger={selectedBlogger}
              onSelect={setSelectedBlogger}
            />
            <StockList
              market={market}
              selectedTicker={selectedTicker}
              onSelect={setSelectedTicker}
            />
          </div>
        </details>
      </div>
    </div>
  );
}
