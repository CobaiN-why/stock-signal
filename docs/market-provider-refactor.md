# Market Provider Refactor

Date: 2026-06-05

This document describes the current architecture after the market/source/provider refactor. The goal is to keep the existing US workflow working while making future China A-share support a provider addition instead of a rewrite.

## Current Scope

- US market remains the only fully wired market data provider.
- CN market is represented in types, API parameters, UI switching, and schema, but no live A-share data provider is connected yet.
- Telegram is no longer part of the ingest path. Signal events are stored in PostgreSQL and shown on the dashboard.
- Sentiment and analysis AI providers are configurable through the provider layer.

## Main Boundaries

| Boundary | Files | Responsibility |
| --- | --- | --- |
| Market metadata | `src/lib/markets.ts` | Market normalization, labels, currency, ticker prefix |
| Post source | `src/lib/social/*` | Fetch external posts. TwitterAPI.io is implemented as `PostSource` |
| Market data | `src/lib/market-data/*` | Fetch bars, latest prices, and profiles. US uses Twelve Data + Finnhub |
| AI provider | `src/lib/ai/*` | Call Kimi or DeepSeek through one chat interface |
| Ingest pipeline | `src/lib/ingest.ts` | Fetch posts, identify stocks/sectors, classify sentiment, store DB records/events |
| Stock identification | `src/lib/stock-identifier.ts` | Market-specific ticker/code rules plus keyword mappings |
| Sector identification | `src/lib/sector-identifier.ts` | Sector keyword mappings from DB |
| Signal events | `src/lib/signal-events.ts` | Persist events for page display and future push channels |

## Persistence Model

The database is the source of truth.

- Posts are stored in `posts`.
- Stock mentions are stored in `post_stocks`.
- Sector mentions are stored in `post_sectors`.
- Stocks and ETFs are both stored in `stocks`; ETFs use `asset_type = "ETF"`.
- Sector definitions are stored in `sectors`.
- Sector keyword rules are stored in `sector_keywords`.
- Sector ETF recommendations are stored in `sector_etfs`.
- In-page alerts are stored in `signal_events`.
- Stock detail responses are precomputed into `stocks.cached_response`.

`Stock.ticker` is not globally unique anymore. Code should use `market + ticker`, exposed by Prisma as `market_ticker`.

## AI Configuration

Supported providers:

- `kimi`
- `deepseek`

Environment variables:

- `AI_PROVIDER`
- `SENTIMENT_AI_PROVIDER`
- `SENTIMENT_AI_MODEL`
- `ANALYSIS_AI_PROVIDER`
- `ANALYSIS_AI_MODEL`
- `KIMI_API_KEY`
- `DEEPSEEK_API_KEY`

Rules run before AI for sentiment detection. If rules return a clear result, no model call is made.

## Adding A-Share Support Later

The expected implementation path is:

1. Add a CN provider implementing `MarketDataProvider` in `src/lib/market-data/cn.ts`.
2. Register it in `src/lib/market-data/index.ts`.
3. Add CN sector definitions, keywords, stock mappings, and ETF recommendations to `src/data/sectors.json`.
4. Add CN stock keywords to a market-aware seed source, or split `keywords.json` by market.
5. Add a CN-focused `PostSource` if the source is not X/Twitter.
6. Set target bloggers to `market = "CN"`.
7. Run `npx prisma db push`, `npx prisma generate`, and `npx prisma db seed`.

Routes and components should already accept `market=CN`; the missing piece is the live data provider and source data quality.
