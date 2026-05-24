"use client";

import { useState, useCallback } from "react";
import Header from "@/components/Header";
import BloggerList from "@/components/BloggerList";
import StockList from "@/components/StockList";
import PriceChart from "@/components/PriceChart";
import StockInfo from "@/components/StockInfo";
import PostTimeline from "@/components/PostTimeline";

export default function Dashboard() {
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [selectedBlogger, setSelectedBlogger] = useState<string | null>(null);
  const [highlightPostId, setHighlightPostId] = useState<string | null>(null);

  const handleMentionClick = useCallback((postId: string) => {
    setHighlightPostId(postId);
    setTimeout(() => setHighlightPostId(null), 3000);
  }, []);

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <div className="flex-1 flex px-6 gap-6 pb-4">
        {/* Left Sidebar */}
        <aside className="w-[260px] shrink-0 hidden md:flex flex-col gap-4">
          <div className="bg-[var(--card-bg)] border border-[var(--border-soft)] rounded-lg p-4 shadow-sm">
            <BloggerList
              selectedBlogger={selectedBlogger}
              onSelect={setSelectedBlogger}
            />
          </div>
          <div className="bg-[var(--card-bg)] border border-[var(--border-soft)] rounded-lg p-4 shadow-sm flex-1 min-h-0 flex flex-col">
            <StockList
              selectedTicker={selectedTicker}
              onSelect={setSelectedTicker}
            />
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 min-w-0 space-y-6">
          {/* Price Chart */}
          <div className="bg-[var(--card-bg)] border border-[var(--border-soft)] rounded-lg p-4 shadow-sm">
            <PriceChart
              ticker={selectedTicker}
              selectedBlogger={selectedBlogger}
              onMentionClick={handleMentionClick}
            />
          </div>

          {/* Stock Info (replaces old timeline position) */}
          <StockInfo ticker={selectedTicker} />
        </main>
      </div>

      {/* Bottom: Mention Timeline (replaces old Opinion Tape) */}
      <div className="px-6 pb-6">
        <PostTimeline
          ticker={selectedTicker}
          selectedBlogger={selectedBlogger}
          highlightPostId={highlightPostId}
        />
      </div>

      {/* Mobile Sidebar */}
      <div className="md:hidden px-6 pb-4">
        <details className="bg-[var(--card-bg)] border border-[var(--border-soft)] rounded-lg p-4">
          <summary className="font-serif-title text-sm cursor-pointer">
            Bloggers & Symbols
          </summary>
          <div className="mt-3">
            <BloggerList
              selectedBlogger={selectedBlogger}
              onSelect={setSelectedBlogger}
            />
            <StockList
              selectedTicker={selectedTicker}
              onSelect={setSelectedTicker}
            />
          </div>
        </details>
      </div>
    </div>
  );
}
