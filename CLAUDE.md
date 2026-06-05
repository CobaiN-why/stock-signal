# Stock Signal Dashboard

Multi-source market signal dashboard. Tracks finance bloggers, extracts stock and sector mentions, displays price charts with mention markers, records signal events in the database, and recommends sector ETFs.

## Tech Stack

- **Framework**: Next.js 16 (App Router, TypeScript)
- **Database**: Supabase PostgreSQL via Prisma ORM
- **Charts**: TradingView Lightweight Charts
- **Styling**: Tailwind CSS
- **External APIs**: TwitterAPI.io, Twelve Data (US price bars), Finnhub (US quote + profile), Kimi (Moonshot) AI, DeepSeek AI
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
│   │   │   ├── daily/          # Combined job: 6 steps (see Daily Cron below); returns 200 immediately, job runs in background
│   │   │   ├── fetch-posts/    # Fetch posts, identify stocks/sectors, record signal events
│   │   │   ├── sync-prices/    # Backfill OHLCV bars via Twelve Data
│   │   │   └── update-latest/  # Refresh latest prices
│   │   ├── bloggers/   # Blogger CRUD, market-scoped
│   │   ├── events/     # In-page signal event stream
│   │   ├── sectors/    # Sector list + ETF recommendations
│   │   ├── stocks/     # Market-scoped stock list & detail
│   │   ├── posts/      # Post queries
│   │   └── stats/      # Dashboard stats
│   ├── layout.tsx
│   └── page.tsx
├── components/          # BloggerList, Header, PostTimeline, PriceChart, StockInfo, StockList
├── lib/
│   ├── ai/              # AI provider abstraction: Kimi and DeepSeek
│   ├── market-data/     # Market data provider abstraction; US provider uses Twelve Data + Finnhub
│   ├── social/          # Post source abstraction; TwitterAPI.io source currently implemented
│   ├── cron-auth.ts     # Bearer token + ?secret= query param auth
│   ├── db.ts            # Prisma client singleton
│   ├── ingest.ts        # Shared post ingest pipeline used by cron routes
│   ├── kimi.ts          # AI stock analysis, provider-backed
│   ├── markets.ts       # Market/currency/label helpers
│   ├── sector-identifier.ts # Sector keyword DB lookup
│   ├── sentiment.ts     # Bullish/bearish detection (rules + configurable AI fallback)
│   ├── signal-events.ts # DB-backed signal event writer
│   ├── stock-identifier.ts  # Market-specific ticker/code + keyword DB lookup
│   ├── telegram.ts      # Legacy Telegram sender; not used by current ingest path
│   ├── twitter.ts       # Compatibility wrapper for social/twitter
│   └── yahoo.ts         # Compatibility wrapper for US market data
└── data/                # keywords.json, sectors.json
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
- Signal events are stored in `signal_events` for: newly discovered stocks, sector mentions, sentiment flips, blogger divergence, and ingest errors
- Before deploying US price/API changes: run `node --env-file=.env --import tsx scripts/test-prices.ts` locally to confirm Twelve Data + Finnhub work
- `stocks/[ticker]?market=US` API is **read-only DB** — never calls price/profile APIs or AI; all pre-fetching is done in daily cron
- `Stock.ticker` is no longer globally unique; use the Prisma composite key `market_ticker`
- New external data sources should implement `PostSource` or `MarketDataProvider` instead of branching inside API routes
- AI model changes should go through `src/lib/ai`; prefer env overrides over hard-coded model names
- Deployment: `git push` to `maomou/stock-signal` (GitHub) → Railway auto-deploys

## Caching Strategy

| Data | Cache location | TTL |
|------|---------------|-----|
| Provider profile | `stocks.profile_data` (DB) | 24 hours |
| AI analysis | `stock_analyses` table (DB) | Permanent (never refresh) |
| Stock detail API response | In-memory Map + `stocks.cached_response` | 12 hours / cron pre-warm |
| Signal events | `signal_events` table (DB) | Permanent until manually cleaned |

## Daily Cron Steps (`/api/cron/daily`)

> Endpoint returns `{ ok: true, status: "running" }` immediately (HTTP 200). Job runs asynchronously in background. Step results appear in Railway logs, not in the HTTP response.

| Step | Name | What it does |
|------|------|-------------|
| 1 | fetch-posts | Pull new posts, identify stocks and sectors, detect sentiment, write signal events |
| 2 | sync-prices | Backfill OHLCV bars via market-data provider; US provider uses Twelve Data |
| 3 | update-latest | Refresh latest prices via market-data provider; US provider uses Finnhub /quote |
| 4 | sync-profiles | Fetch provider profiles for all stocks missing/stale (24h TTL) |
| 5 | generate-analyses | Generate AI analysis for stocks with profile but no analysis (permanent) |
| 6 | prewarm-cache | Build stock detail responses and store them in `stocks.cached_response` |

## Deep Docs

| Topic | Path |
|-------|------|
| Original design spec | `docs/superpowers/specs/2026-05-24-stock-signal-dashboard-design.md` |
| Sentiment & divergence spec | `docs/superpowers/specs/2026-05-27-sentiment-analysis-design.md` |
