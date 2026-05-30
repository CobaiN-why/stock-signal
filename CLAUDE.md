# Stock Signal Dashboard

Multi-blogger stock mention tracker. Tracks X (Twitter) bloggers, extracts stock mentions, displays price charts with mention markers, pushes new stock discoveries to Telegram.

## Tech Stack

- **Framework**: Next.js 15 (App Router, TypeScript)
- **Database**: Supabase PostgreSQL via Prisma ORM
- **Charts**: TradingView Lightweight Charts
- **Styling**: Tailwind CSS
- **External APIs**: TwitterAPI.io, Twelve Data (price bars), Finnhub (quote + profile), Telegram Bot API, Kimi (Moonshot) AI
- **Hosting**: Railway
- **Cron**: cron-job.org (daily trigger)

## Commands

```bash
npm run dev          # Start dev server (http://localhost:3000)
npm run build        # Production build
npm run lint         # ESLint check
npx prisma studio   # Browse database
npx prisma db push  # Push schema changes to DB
npx prisma generate # Regenerate Prisma client
npx prisma db seed  # Seed keyword mappings
```

## Project Structure

```
src/
├── app/
│   ├── api/
│   │   ├── cron/
│   │   │   ├── daily/          # Combined job: 5 steps (see Daily Cron below); returns 200 immediately, job runs in background
│   │   │   ├── fetch-posts/    # Fetch tweets, identify stocks, push Telegram for new stocks / sentiment flips / divergence
│   │   │   ├── sync-prices/    # Backfill OHLCV bars via Twelve Data
│   │   │   └── update-latest/  # Refresh latest prices
│   │   ├── bloggers/   # Blogger CRUD
│   │   ├── stocks/     # Stock list & detail (with 60s memory cache)
│   │   ├── posts/      # Post queries
│   │   └── stats/      # Dashboard stats
│   ├── layout.tsx
│   └── page.tsx
├── components/          # BloggerList, Header, PostTimeline, PriceChart, StockInfo, StockList
├── lib/
│   ├── cron-auth.ts     # Bearer token + ?secret= query param auth
│   ├── db.ts            # Prisma client singleton
│   ├── kimi.ts          # Kimi AI stock analysis (generate once, never refresh)
│   ├── sentiment.ts     # Bullish/bearish detection (rules + Kimi AI fallback)
│   ├── stock-identifier.ts  # Cashtag regex + keyword DB lookup
│   ├── telegram.ts      # Telegram push (new stocks, sentiment flips, divergence, error alerts)
│   ├── twitter.ts       # TwitterAPI.io fetch
│   └── yahoo.ts         # Price/profile data (filename legacy): bars via Twelve Data, quote+profile via Finnhub
└── data/                # keywords.json
scripts/
├── backfill-profiles.ts    # One-off: backfill missing Finnhub profiles + Kimi analyses
├── backfill-sentiment.ts   # One-off: backfill sentiment for all PostStock records
├── rerun-ai-sentiment.ts   # One-off: re-run AI sentiment for records where rules don't match
└── test-prices.ts          # Local smoke test: verify Twelve Data + Finnhub for all tracked tickers
```

## Conventions

- All API routes under `src/app/api/`
- All shared utilities under `src/lib/`
- Cron auth: `Authorization: Bearer <CRON_SECRET>` header, or `?secret=<CRON_SECRET>` query param (GET)
- Database access only through Prisma client (`src/lib/db.ts`)
- Environment variables defined in `.env.example`
- Telegram push for: **newly discovered** stocks (first-time `ensureStockExists`), **sentiment flips** (same blogger changes view on same stock), **new divergence** (bloggers disagree for first time on a stock), **cron errors** (Twitter API failure → personal + group both receive alert)
- Before deploying price/API changes: run `node --env-file=.env --import tsx scripts/test-prices.ts` locally to confirm both providers work
- Telegram sends to **both** `TELEGRAM_CHAT_ID` (personal) and `TELEGRAM_GROUP_CHAT_ID` (channel) in parallel
- `stocks/[ticker]` API is **read-only DB** — never calls price/profile APIs or Kimi; all pre-fetching is done in daily cron
- Deployment: `git push` to `maomou/stock-signal` (GitHub) → Railway auto-deploys

## Caching Strategy

| Data | Cache location | TTL |
|------|---------------|-----|
| Finnhub profile | `stocks.profile_data` (DB) | 24 hours |
| Kimi analysis | `stock_analyses` table (DB) | Permanent (never refresh) |
| Stock detail API response | In-memory Map | 60 seconds |

## Daily Cron Steps (`/api/cron/daily`)

> Endpoint returns `{ ok: true, status: "running" }` immediately (HTTP 200). Job runs asynchronously in background. Step results appear in Railway logs, not in the HTTP response.

| Step | Name | What it does |
|------|------|-------------|
| 1 | fetch-posts | Pull new tweets, identify stocks, detect sentiment (rules + Kimi AI), Telegram push for new stocks / sentiment flips / divergence |
| 2 | sync-prices | Backfill OHLCV bars via Twelve Data (throttled 8s/call; OTC symbols skipped gracefully) |
| 3 | update-latest | Refresh real-time prices via Finnhub /quote |
| 4 | sync-profiles | Fetch Finnhub profiles for all stocks missing/stale (24h TTL) |
| 5 | generate-analyses | Generate Kimi analysis for stocks with profile but no analysis (permanent) |

## Deep Docs

| Topic | Path |
|-------|------|
| Original design spec | `docs/superpowers/specs/2026-05-24-stock-signal-dashboard-design.md` |
| Sentiment & divergence spec | `docs/superpowers/specs/2026-05-27-sentiment-analysis-design.md` |
