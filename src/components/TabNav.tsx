"use client";

const tabs = [
  { key: "overview", label: "信号总览" },
  { key: "bloggers", label: "博主库" },
  { key: "watchlist", label: "个人关注" },
];

interface Props {
  active: string;
  onChange: (key: string) => void;
}

export default function TabNav({ active, onChange }: Props) {
  return (
    <nav className="flex border-b border-[var(--border)] mb-6">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          onClick={() => onChange(tab.key)}
          className={`relative px-6 py-3 text-sm font-medium transition-colors ${
            active === tab.key
              ? "text-[var(--text-primary)]"
              : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          }`}
        >
          {tab.label}
          {active === tab.key && (
            <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-[var(--accent)] rounded-full" />
          )}
        </button>
      ))}
    </nav>
  );
}
