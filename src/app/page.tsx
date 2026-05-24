"use client";

import { useState, useCallback } from "react";
import Header from "@/components/Header";
import BloggerList from "@/components/BloggerList";
import StockList from "@/components/StockList";
import PriceChart from "@/components/PriceChart";
import PostTimeline from "@/components/PostTimeline";
import OpinionTape from "@/components/OpinionTape";

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
        <aside className="w-[250px] shrink-0 hidden md:block">
          <BloggerList
            selectedBlogger={selectedBlogger}
            onSelect={setSelectedBlogger}
          />
          <StockList
            selectedTicker={selectedTicker}
            onSelect={setSelectedTicker}
          />
        </aside>

        {/* Main Content */}
        <main className="flex-1 min-w-0 space-y-6">
          <div className="bg-[var(--card-bg)] border border-[var(--border-soft)] rounded-lg p-4 shadow-sm">
            <PriceChart
              ticker={selectedTicker}
              selectedBlogger={selectedBlogger}
              onMentionClick={handleMentionClick}
            />
          </div>
          <PostTimeline
            ticker={selectedTicker}
            selectedBlogger={selectedBlogger}
            highlightPostId={highlightPostId}
          />
        </main>
      </div>

      {/* Mobile Sidebar (visible on small screens) */}
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

      <OpinionTape />
    </div>
  );
}
