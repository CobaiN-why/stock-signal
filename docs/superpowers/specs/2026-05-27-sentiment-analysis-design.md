# Sentiment Analysis & Divergence Module Design

Date: 2026-05-27

## Overview

Add sentiment (bullish/bearish) detection to tweet mentions, display sentiment-aware markers on price charts, show a divergence analysis module with cumulative return, and push Telegram alerts when blogger opinions flip or diverge.

## 1. Data Model

### PostStock table: add `sentiment` field

```prisma
model PostStock {
  id          String  @id @default(uuid())
  postId      String  @map("post_id")
  stockId     String  @map("stock_id")
  mentionType String  @map("mention_type")   // "cashtag" | "keyword"
  sentiment   String? @map("sentiment")      // "bullish" | "bearish" | null

  post  Post  @relation(fields: [postId], references: [id])
  stock Stock @relation(fields: [stockId], references: [id])

  @@unique([postId, stockId])
  @@map("post_stocks")
}
```

- `null` = rules and AI both unable to determine; keeps existing circle marker on chart
- No backfill for historical data; all existing records stay `null`
- Written at insert time in fetch-posts cron

### No new tables

Divergence detection, opinion change tracking, and cumulative return are all computed at query time. Current data volume (tens of bloggers, hundreds of posts) makes this trivial.

## 2. Sentiment Detection Logic

Hybrid: rules first, Kimi AI fallback. Executed in `fetch-posts/route.ts` before `postStock.create`.

### Layer 1: Rule-based keyword matching (zero cost, <1ms)

New module: `src/lib/sentiment.ts`

Bullish signals: `buy`, `long`, `bullish`, `加仓`, `看好`, `看多`, `买入`, `上车`, `moon`, `calls`, `undervalued`, `底部`, `抄底`, `起飞`, etc.

Bearish signals: `sell`, `short`, `bearish`, `减仓`, `看空`, `卖出`, `puts`, `overvalued`, `下车`, `泡沫`, `见顶`, `崩`, etc.

Logic: count hits for each side. If one side > the other → return that sentiment. If tied or zero hits → fall through to Layer 2.

### Layer 2: Kimi AI fallback (only when rules fail)

- Model: `moonshot-v1-8k` (cheapest, sufficient for single-tweet classification)
- Prompt: given tweet content and ticker, return `bullish`, `bearish`, or `null`
- Returns `null` → sentiment field is `null`, chart keeps circle marker
- Add function to `src/lib/sentiment.ts` alongside rules

## 3. Opinion Change Detection & Telegram Push

Both checks run in `fetch-posts/route.ts` immediately after inserting a PostStock with non-null sentiment.

### Trigger 1: Same blogger flips on same stock

- Query: find this blogger's previous PostStock for this stock where sentiment is not null (ordered by post.postedAt DESC, skip the one just inserted)
- If previous sentiment exists and differs from current → push

Message format:
```
⚡ 观点反转: $TICKER
👤 @blogger_name: bullish → bearish
📝 {tweet content, first 100 chars}
🔗 {tweet URL}
```

### Trigger 2: New divergence among bloggers

- Query: for this stock, get each blogger's latest PostStock where sentiment is not null (one per blogger, most recent by post.postedAt)
- If both bullish and bearish exist in the result set → check whether this divergence is newly caused by the current insert (i.e., before this insert, all bloggers with sentiment agreed)
- New divergence → push

Message format:
```
⚠️ 观点分歧: $TICKER
🟢 看多: @blogger_a, @blogger_b
🔴 看空: @blogger_c
📝 {triggering tweet content, first 100 chars}
🔗 {tweet URL}
```

Both push to `TELEGRAM_CHAT_ID` and `TELEGRAM_GROUP_CHAT_ID` in parallel (existing pattern).

## 4. Chart Marker Changes

### PriceChart.tsx marker shape by sentiment

| sentiment | shape | note |
|-----------|-------|------|
| `bullish` | `arrowUp` | blogger color, native LW Charts shape |
| `bearish` | `arrowDown` | blogger color, native LW Charts shape |
| `null` | `circle` | blogger color, same as current |

### Data flow

`/api/stocks/[ticker]` response: each mention's PostStock includes `sentiment` field. PriceChart reads it to select marker shape.

### Tooltip enhancement

Hover card adds a small label: `看多` (green) or `看空` (red) when sentiment is non-null.

## 5. Divergence Module UI

### Position

StockInfo component, inserted between metrics grid / company description and 纵横分析报告.

### Layout: cumulative return (hero) + summary card + expandable blogger timeline

#### Cumulative return (visual focus)

- Large font: `text-2xl font-bold font-mono`, dominates the left side of the card
- Format: `+42.3%` or `-12.7%`
- Color: **red for positive** (涨), **green for negative** (跌) — A-share convention
- Below in small text: `自 2026-03-15 首次提及`
- Calculation: `(latestPrice - firstMentionClose) / firstMentionClose * 100`
  - `firstMentionClose`: `PriceHistory` where `stockId = X AND date >= Stock.createdAt` ORDER BY date ASC LIMIT 1, take `close`
  - `latestPrice`: `Stock.latestPrice`

#### Summary card (right side)

- Bull/bear ratio bar (red bullish / green bearish proportion by blogger count)
- Text: "3 位看多，1 位看空" or "全部看多（4 位）"
- If any blogger has flipped, show: "⚡ @xxx 近期观点反转（bull→bear）"

#### Expandable blogger timeline (collapsed by default)

- One row per blogger: `@username` + blogger color dot
- Right side: chronological sentiment sequence for this stock: `▲ ▲ ▼` (date tooltip on hover)
- Bloggers with flips highlighted

### Data source

All computed from existing mentions data returned by `/api/stocks/[ticker]`. No extra API endpoint needed. Frontend aggregation.

## 6. API Changes

### `/api/stocks/[ticker]` response additions

```typescript
// Existing mentions already include post.blogger info
// Add sentiment to each mention:
interface Mention {
  id: string;
  mentionType: string;
  sentiment: string | null;  // NEW
  post: { ... };
}

// New fields at top level:
interface StockDetail {
  // ... existing fields ...
  cumulativeReturn: number | null;       // percentage, e.g. 42.3
  firstMentionDate: string | null;       // ISO date string
}
```

Cumulative return is computed server-side (single DB query for first price point) and cached with the 60-second in-memory cache.

## 7. File Changes Summary

| File | Change |
|------|--------|
| `prisma/schema.prisma` | Add `sentiment` field to PostStock |
| `src/lib/sentiment.ts` | **New**: rule-based + Kimi AI sentiment detection |
| `src/lib/telegram.ts` | Add `sendSentimentFlip` and `sendDivergence` functions |
| `src/app/api/cron/fetch-posts/route.ts` | Call sentiment detection, call change/divergence checks |
| `src/app/api/stocks/[ticker]/route.ts` | Return sentiment in mentions, add cumulativeReturn & firstMentionDate |
| `src/components/PriceChart.tsx` | Use arrowUp/arrowDown shapes by sentiment, enhance tooltip |
| `src/components/StockInfo.tsx` | Insert divergence module between profile and analysis |
