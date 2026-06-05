# Stock Signal Dashboard

Multi-source market signal dashboard. It monitors finance bloggers, extracts stock and sector mentions, classifies sentiment, stores the results in PostgreSQL, and displays price charts with mention markers plus in-page signal events.

## Features

- Track multiple finance bloggers, each scoped to a market and color-coded on charts
- Auto-extract stock tickers via market-specific rules and keyword matching
- Identify sector mentions from a seeded sector keyword library
- Interactive price charts (TradingView Lightweight Charts) with sentiment-aware markers (▲ bullish / ▼ bearish)
- Sentiment detection per post (keyword rules + configurable AI fallback: Kimi or DeepSeek)
- Blogger opinion divergence module with cumulative return since first mention
- AI-powered stock analysis reports through the configured analysis provider
- In-page signal event stream for new stocks, sector mentions, sentiment flips, divergence, and ingest errors
- Sector ETF recommendation module, with ETF instruments stored as first-class tracked assets
- Provider-based market data integration; US currently uses Twelve Data for daily bars and Finnhub for latest price/profile

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

## Daily Automation

A combined cron endpoint at `/api/cron/daily` runs six steps sequentially:

1. **Fetch posts** — pull new posts from tracked bloggers, identify stock and sector mentions, detect sentiment, write signal events on new stocks/flips/divergence
2. **Sync prices** — backfill daily OHLCV bars from the market data provider
3. **Update latest** — refresh real-time prices
4. **Sync profiles** — fetch provider profile data for all stocks (24h cache)
5. **Generate analyses** — generate AI analysis for stocks with profile but no analysis (permanent)
6. **Pre-warm cache** — store stock detail JSON in `stocks.cached_response`

Trigger via GET with `?secret=<CRON_SECRET>` or POST with `Authorization: Bearer <CRON_SECRET>`.

Scheduled daily at 02:00 Beijing time via cron-job.org.

## Deployment

Push to `main` branch → Railway auto-deploys via GitHub integration.

## Architecture Notes

The provider refactor is documented in `docs/market-provider-refactor.md`. Add future A-share support by implementing a CN `MarketDataProvider`, adding CN sector/ETF seed data, and assigning CN bloggers to `market = "CN"`.
