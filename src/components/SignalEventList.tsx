"use client";

import { useEffect, useState } from "react";
import type { Market } from "@/lib/markets";

interface SignalEvent {
  id: string;
  eventType: string;
  severity: string;
  title: string;
  body: string;
  sourceUrl: string | null;
  createdAt: string;
  stock: { ticker: string; market: string; assetType: string } | null;
  sector: { slug: string; name: string } | null;
}

interface Props {
  market: Market;
}

const eventLabels: Record<string, string> = {
  new_stock: "新标的",
  sentiment_flip: "观点反转",
  divergence: "观点分歧",
  sector_mention: "板块",
  ingest_alert: "异常",
};

export default function SignalEventList({ market }: Props) {
  const [events, setEvents] = useState<SignalEvent[]>([]);

  useEffect(() => {
    fetch(`/api/events?market=${market}&limit=12`)
      .then((r) => r.json())
      .then((d) => setEvents(d.events || []))
      .catch(() => {});
  }, [market]);

  return (
    <div className="bg-[var(--card-bg)] border border-[var(--border-soft)] rounded-lg p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-serif-title text-sm text-[var(--text-secondary)]">
          Signal Events
        </h2>
        <span className="text-xs text-[var(--text-secondary)]">{market}</span>
      </div>

      <div className="space-y-2 max-h-[280px] overflow-y-auto scrollbar-hide">
        {events.map((event) => (
          <div
            key={event.id}
            className="border border-[var(--border-soft)] rounded-lg px-3 py-2"
          >
            <div className="flex items-center gap-2 mb-1">
              <span
                className={`text-[10px] rounded px-1.5 py-0.5 ${
                  event.severity === "error"
                    ? "bg-red-50 text-red-700"
                    : event.severity === "warning"
                      ? "bg-amber-50 text-amber-700"
                      : "bg-[var(--border-soft)] text-[var(--text-secondary)]"
                }`}
              >
                {eventLabels[event.eventType] ?? event.eventType}
              </span>
              <span className="text-xs text-[var(--text-secondary)] ml-auto">
                {new Date(event.createdAt).toLocaleString("zh-CN", {
                  month: "2-digit",
                  day: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </div>
            <div className="text-sm font-bold">{event.title}</div>
            <p className="text-xs text-[var(--text-secondary)] leading-relaxed mt-1 line-clamp-2 whitespace-pre-wrap">
              {event.body}
            </p>
            {event.sourceUrl && (
              <a
                href={event.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-[var(--accent-green)] hover:underline mt-1 inline-block"
              >
                查看来源
              </a>
            )}
          </div>
        ))}

        {events.length === 0 && (
          <p className="text-xs text-[var(--text-secondary)] text-center py-4">
            暂无页面事件
          </p>
        )}
      </div>
    </div>
  );
}
