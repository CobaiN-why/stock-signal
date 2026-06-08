# Stock Signal Dashboard

Multi-source market signal dashboard. It monitors finance bloggers, extracts stock and sector mentions, classifies sentiment, stores the results in PostgreSQL, and displays price charts with mention markers plus in-page signal events.

## Features

- Track one shared finance blogger watchlist and color-code each blogger on charts
- Auto-extract US stocks, A-share stocks, and ETFs via market-specific rules and keyword matching
- Identify sector mentions from a seeded sector keyword library
- Infer weaker sector links from mentioned stocks, e.g. NVDA -> semiconductors, with confidence labels
- Interactive price charts (TradingView Lightweight Charts) with sentiment-aware markers (▲ bullish / ▼ bearish)
- Sentiment detection per post (keyword rules + configurable AI fallback: Kimi or DeepSeek)
- Blogger opinion divergence module with cumulative return since first mention
- AI-powered stock analysis reports through the configured analysis provider
- In-page signal event stream for new stocks, sector mentions, sentiment flips, divergence, and ingest errors
- Sector ETF recommendation module, with ETF instruments stored as first-class tracked assets and clickable ETF charts
- Provider-based market data integration; US uses Twelve Data/Finnhub, CN uses a Python AkShare bridge

## Tech Stack

Next.js 16 (App Router) · TypeScript · Supabase PostgreSQL · Prisma ORM · TradingView Lightweight Charts · Tailwind CSS · Railway

## Setup

```bash
npm install
cp .env.example .env   # Fill in all required values
npx prisma db push
npx prisma db seed
npm run dev
```

## Environment Variables

See `.env.example` for the full list:

- `DATABASE_URL` — Supabase PostgreSQL connection string
- `TWITTER_API_KEY` — TwitterAPI.io key
- `CRON_SECRET` — Shared secret for cron and admin endpoints
- `KIMI_API_KEY` — Moonshot Kimi API key, used when `AI_PROVIDER`/`SENTIMENT_AI_PROVIDER`/`ANALYSIS_AI_PROVIDER` selects `kimi`
- `DEEPSEEK_API_KEY` — DeepSeek API key, used when a provider selects `deepseek`
- `AI_PROVIDER` — Default AI provider (`kimi` or `deepseek`)
- `SENTIMENT_AI_PROVIDER` / `SENTIMENT_AI_MODEL` — Optional override for sentiment classification
- `ANALYSIS_AI_PROVIDER` / `ANALYSIS_AI_MODEL` — Optional override for stock analysis reports
- `POST_SOURCE` — Post source provider; currently `twitter`
- `TWELVE_DATA_API_KEY` / `FINNHUB_API_KEY` — US market data providers
- `CN_MARKET_DATA_PYTHON` — Python executable for the AkShare CN provider, defaults to `python3`

## China Market Data

CN stock and ETF bars are fetched through `scripts/cn-akshare-provider.py`, which calls AkShare from Python. On Linux install:

```bash
python3 -m pip install akshare pandas
```

Seed common A-share stocks/ETFs:

```bash
npx prisma db seed
```

Sync one CN instrument:

```bash
curl -X POST "http://127.0.0.1:3000/api/cron/sync-prices?market=CN&ticker=600519" \
  -H "Authorization: Bearer <CRON_SECRET>"
```

Sync all seeded CN instruments:

```bash
curl -X POST "http://127.0.0.1:3000/api/cron/sync-prices?market=CN&includeSeeded=true" \
  -H "Authorization: Bearer <CRON_SECRET>"
```

## Daily Automation

A combined cron endpoint at `/api/cron/daily` runs six steps sequentially:

1. **Fetch posts** — pull new posts from the shared blogger watchlist, identify US/CN stock and sector mentions, detect sentiment, write signal events on new stocks/flips/divergence
2. **Sync prices** — backfill daily OHLCV bars from the market data provider
3. **Update latest** — refresh real-time prices
4. **Sync profiles** — fetch provider profile data for all stocks (24h cache)
5. **Generate analyses** — generate AI analysis for stocks with profile but no analysis (permanent)
6. **Pre-warm cache** — store stock detail JSON in `stocks.cached_response`

Trigger via GET with `?secret=<CRON_SECRET>` or POST with `Authorization: Bearer <CRON_SECRET>`.

Scheduled daily at 02:00 Beijing time via cron-job.org.

## Sector and ETF Signals

Sector mentions have two strengths:

- **Direct** — the post explicitly mentions a sector keyword such as `半导体`, `芯片`, or `AI infrastructure`.
- **Weak inferred** — the post mentions a stock already mapped to a sector, such as `NVDA` implying semiconductors. These are shown as weak associations on ETF charts.

Sector ETF cards are sorted by the configured size-priority `rank`. Clicking an ETF switches the main chart to that ETF and overlays both direct ETF mentions and related sector opinions.

Reprocess already stored posts after changing stock/sector rules:

```bash
npm run reprocess:posts -- --dry-run --limit 20
npm run reprocess:posts -- --username serenity --limit 100
```

Add `--rules-only` to avoid AI sentiment calls, or `--prune` to remove old links that are no longer detected.

## Deployment

Push to `main` branch → Railway auto-deploys via GitHub integration.

## Architecture Notes

The provider refactor is documented in `docs/market-provider-refactor.md`. A-share support is implemented as a CN `MarketDataProvider` plus CN sector/ETF seed data. Bloggers are a shared watchlist; the ingest pipeline classifies each post into the relevant market by its stock and sector mentions.
