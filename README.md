# Stock Signal Dashboard

Multi-blogger stock mention tracker that monitors X (Twitter) accounts for stock mentions, aggregates them by ticker, and displays interactive price charts with mention markers.

## Features

- Track multiple X bloggers, each with distinct color-coded markers
- Auto-extract stock tickers via $CASHTAG and keyword matching
- Interactive price charts (TradingView Lightweight Charts) with sentiment-aware markers (▲ bullish / ▼ bearish)
- Sentiment detection per tweet (keyword rules + Kimi AI fallback)
- Blogger opinion divergence module with cumulative return since first mention
- AI-powered stock analysis reports (Kimi/Moonshot)
- Telegram push notifications for new stocks, sentiment flips, and blogger divergence
- Yahoo Finance integration for price data and company profiles

## Tech Stack

Next.js 15 (App Router) · TypeScript · Supabase PostgreSQL · Prisma ORM · TradingView Lightweight Charts · Tailwind CSS · Railway

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
- `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` — Telegram push (personal chat)
- `TELEGRAM_GROUP_CHAT_ID` — Telegram push (group/channel, optional)
- `CRON_SECRET` — Shared secret for cron and admin endpoints
- `KIMI_API_KEY` — Moonshot Kimi API key for stock analysis

## Daily Automation

A combined cron endpoint at `/api/cron/daily` runs five steps sequentially:

1. **Fetch posts** — pull new tweets from tracked bloggers, identify stock mentions, detect sentiment, push Telegram on flips/divergence
2. **Sync prices** — backfill daily OHLCV bars from Yahoo Finance
3. **Update latest** — refresh real-time prices
4. **Sync profiles** — fetch Yahoo company profiles for all stocks (24h cache)
5. **Generate analyses** — generate Kimi AI analysis for stocks with profile but no analysis (permanent)

Trigger via GET with `?secret=<CRON_SECRET>` or POST with `Authorization: Bearer <CRON_SECRET>`.

Scheduled daily at 02:00 Beijing time via cron-job.org.

## Deployment

Push to `main` branch → Railway auto-deploys via GitHub integration.
