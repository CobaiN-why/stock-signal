interface Tag {
  slug: string;
  name: string;
  score: number;
  totalPredictions: number;
}

interface Props {
  tags: Tag[];
}

export default function TagCloud({ tags }: Props) {
  if (tags.length === 0) {
    return (
      <p className="text-xs text-[var(--text-secondary)]">暂无板块数据</p>
    );
  }

  const maxPredictions = Math.max(...tags.map((t) => t.totalPredictions), 1);

  // Font size: proportional to prediction count
  function fontSize(count: number): string {
    const ratio = count / maxPredictions;
    if (ratio >= 0.8) return "text-sm";
    if (ratio >= 0.5) return "text-xs";
    return "text-[11px]";
  }

  // Color intensity: green tint proportional to score
  function scoreColor(score: number): string {
    if (score >= 70)
      return "bg-emerald-100 text-emerald-800 border-emerald-300";
    if (score >= 40) return "bg-amber-50 text-amber-700 border-amber-200";
    return "bg-gray-50 text-gray-500 border-gray-200";
  }

  return (
    <div className="flex flex-wrap gap-2">
      {tags.map((tag) => (
        <span
          key={tag.slug}
          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full border transition-colors cursor-default ${fontSize(
            tag.totalPredictions
          )} ${scoreColor(tag.score)}`}
          title={`${tag.name}: 可信度 ${tag.score} · ${tag.totalPredictions} 条预测`}
        >
          <span className="font-medium">{tag.name}</span>
          <span className="opacity-60">{tag.totalPredictions}</span>
        </span>
      ))}
    </div>
  );
}
