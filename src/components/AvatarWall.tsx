interface Blogger {
  xUsername: string;
  displayName: string;
  color: string;
  score?: number; // credibility score for gold ring
}

interface Props {
  bloggers: Blogger[];
  max?: number;
  size?: "sm" | "md";
}

export default function AvatarWall({ bloggers, max = 5, size = "sm" }: Props) {
  const display = bloggers.slice(0, max);
  const sizeClass = size === "sm" ? "w-6 h-6 text-[10px]" : "w-8 h-8 text-xs";

  return (
    <div className="flex -space-x-1.5">
      {display.map((b) => {
        const isHighCred = b.score !== undefined && b.score >= 70;
        return (
          <span
            key={b.xUsername}
            className={`${sizeClass} rounded-full flex items-center justify-center text-white font-medium border-2 transition-shadow ${
              isHighCred
                ? "border-amber-300 shadow-sm shadow-amber-200"
                : "border-white"
            }`}
            style={{ backgroundColor: b.color }}
            title={`${b.displayName} (@${b.xUsername})${
              b.score !== undefined ? ` · 可信度 ${b.score}` : ""
            }${isHighCred ? " · 高可信" : ""}`}
          >
            {b.displayName.slice(0, 1)}
          </span>
        );
      })}
      {bloggers.length > max && (
        <span
          className={`${sizeClass} rounded-full bg-[var(--border-soft)] flex items-center justify-center text-[var(--text-secondary)] text-[10px] font-medium border-2 border-white`}
        >
          +{bloggers.length - max}
        </span>
      )}
    </div>
  );
}
