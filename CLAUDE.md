# Stock Signal Dashboard

Multi-blogger stock mention tracker. Tracks X (Twitter) bloggers, extracts stock mentions, displays price charts with mention markers, pushes new stock discoveries to Telegram.

## Tech Stack

- **Framework**: Next.js 15 (App Router, TypeScript)
- **Database**: Supabase PostgreSQL via Prisma ORM
- **Charts**: TradingView Lightweight Charts
- **Styling**: Tailwind CSS
- **External APIs**: TwitterAPI.io, Yahoo Finance, Telegram Bot API, Kimi (Moonshot) AI
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
│   │   │   ├── daily/          # Combined job: 5 steps (see Daily Cron below)
│   │   │   ├── fetch-posts/    # Fetch tweets, identify stocks, push Telegram for new stocks
│   │   │   ├── sync-prices/    # Backfill OHLCV from Yahoo Finance
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
│   ├── stock-identifier.ts  # Cashtag regex + keyword DB lookup
│   ├── telegram.ts      # Telegram push (only for newly discovered stocks)
│   ├── twitter.ts       # TwitterAPI.io fetch
│   └── yahoo.ts         # Yahoo Finance bars + latest price + profile (24h DB cache)
└── data/                # keywords.json
scripts/
└── backfill-profiles.ts # One-off: backfill missing Yahoo profiles + Kimi analyses
```

## Conventions

- All API routes under `src/app/api/`
- All shared utilities under `src/lib/`
- Cron auth: `Authorization: Bearer <CRON_SECRET>` header, or `?secret=<CRON_SECRET>` query param (GET)
- Database access only through Prisma client (`src/lib/db.ts`)
- Environment variables defined in `.env.example`
- Telegram push only for **newly discovered** stocks (first-time `ensureStockExists`), not for repeat mentions
- Telegram sends to **both** `TELEGRAM_CHAT_ID` (personal) and `TELEGRAM_GROUP_CHAT_ID` (channel) in parallel
- `stocks/[ticker]` API is **read-only DB** — never calls Yahoo or Kimi; all pre-fetching is done in daily cron
- Deployment: `git push` to `maomou/stock-signal` (GitHub) → Railway auto-deploys

## Caching Strategy

| Data | Cache location | TTL |
|------|---------------|-----|
| Yahoo profile | `stocks.profile_data` (DB) | 24 hours |
| Kimi analysis | `stock_analyses` table (DB) | Permanent (never refresh) |
| Stock detail API response | In-memory Map | 60 seconds |

## Daily Cron Steps (`/api/cron/daily`)

| Step | Name | What it does |
|------|------|-------------|
| 1 | fetch-posts | Pull new tweets, identify stocks, Telegram push for new ones |
| 2 | sync-prices | Backfill OHLCV bars from Yahoo Finance |
| 3 | update-latest | Refresh real-time prices |
| 4 | sync-profiles | Fetch Yahoo profiles for all stocks missing/stale (24h TTL) |
| 5 | generate-analyses | Generate Kimi analysis for stocks with profile but no analysis (permanent) |

## Deep Docs

| Topic | Path |
|-------|------|
| Original design spec | `docs/superpowers/specs/2026-05-24-stock-signal-dashboard-design.md` |
