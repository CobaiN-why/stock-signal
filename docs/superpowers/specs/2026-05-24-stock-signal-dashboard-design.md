# Stock Signal Dashboard — Design Spec

Multi-blogger stock mention tracker with price charts, post timeline, and Telegram notifications.

## 1. Overview

Track multiple X (Twitter) stock bloggers, extract stock mentions from their posts, aggregate by ticker, and display on an interactive dashboard with price charts and mention markers. Push new mentions to Telegram in real time.

### Core Requirements

- **Multi-blogger**: dynamically add/remove X bloggers to track
- **Stock aggregation**: multiple bloggers mentioning the same stock → aggregated under one ticker
- **Interactive price chart**: click markers on the price curve to see the original post at that date
- **Color-coded markers**: each blogger has a distinct color on the chart
- **Telegram push**: notify on every new stock mention
- **Shareable**: public URL, read-only for shared users
- **Future**: per-user independent spaces with auth

## 2. Tech Stack

| Layer | Choice | Reason |
|-------|--------|--------|
| Framework | Next.js 15 (App Router) | Full-stack unified, largest ecosystem |
| Language | TypeScript | Type safety |
| Database | Supabase PostgreSQL | Free tier, future Auth ready |
| ORM | Prisma | Auto-generated types, schema-as-docs |
| Charts | TradingView Lightweight Charts | Purpose-built for financial charts, free |
| UI | Tailwind CSS | Rapid styling matching reference design |
| Post data | TwitterAPI.io | Pay-per-use, no approval needed |
| Price data | yahoo-finance2 | Free, no API key |
| Notifications | Telegram Bot API | Free, simple |
| Hosting | Railway | $5/month, one-click deploy |
| Cron | Railway Cron / node-cron | Trigger API Routes on schedule |

### Monthly Cost Estimate

- Railway app hosting: ~$5
- TwitterAPI.io (low volume): ~$1-2
- Supabase: $0 (free tier)
- Yahoo Finance: $0
- Telegram: $0
- **Total: ~$6-7/month**

## 3. System Architecture

```
┌─────────────────────────────────────────────────────┐
│                    User Browser                      │
│              Next.js Dashboard (Railway)              │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ Bloggers │  │ Stock List    │  │ Price Chart   │  │
│  └──────────┘  └──────────────┘  └───────────────┘  │
└──────────────────────┬───────────────────────────────┘
                       │ API Routes
┌──────────────────────┼───────────────────────────────┐
│              Next.js Backend (same service)           │
│  ┌──────────┐  ┌─────┴──────┐  ┌───────────────┐    │
│  │ Cron Job │  │ Data Layer  │  │ Telegram Bot  │    │
│  │(scheduled)│  │(fetch+parse)│  │  (push)       │    │
│  └────┬─────┘  └─────┬──────┘  └───────┬───────┘    │
└───────┼──────────────┼─────────────────┼─────────────┘
        │              │                 │
   ┌────▼────┐    ┌────▼────┐      ┌────▼────┐
   │TwitterAPI│    │Supabase │      │Telegram │
   │   .io   │    │PostgreSQL│      │Bot API  │
   └─────────┘    └────┬────┘      └─────────┘
                       │
                  ┌────▼────┐
                  │ Yahoo   │
                  │Finance  │
                  └─────────┘
```

### Data Flow

1. **Cron triggers** (every 6 hours) → call TwitterAPI.io for each active blogger's incremental posts
2. **Identification engine** → extract $CASHTAG and keyword-matched tickers from post text
3. **Persist** → write posts + stock associations to Supabase
4. **Push** → new stock mention → send Telegram message
5. **Price sync** → daily after market close, pull Yahoo Finance daily bars for all tracked stocks
6. **Frontend** → Dashboard reads Supabase, renders charts and timelines

## 4. Database Schema

### bloggers
| Column | Type | Notes |
|--------|------|-------|
| id | uuid, PK | |
| x_username | text, unique | e.g. "hedgeye" |
| display_name | text | |
| color | text | Assigned marker color, e.g. "#FF6B35" |
| avatar_url | text, nullable | |
| is_active | boolean | Whether tracking is enabled |
| created_at | timestamptz | |
| last_fetched_at | timestamptz | For incremental fetching |

### posts
| Column | Type | Notes |
|--------|------|-------|
| id | uuid, PK | |
| blogger_id | uuid, FK → bloggers | |
| x_post_id | text, unique | Twitter post ID, dedup key |
| content | text | Full post text |
| posted_at | timestamptz | When posted on X |
| url | text | Link to original post |
| fetched_at | timestamptz | |

### stocks
| Column | Type | Notes |
|--------|------|-------|
| id | uuid, PK | |
| ticker | text, unique | e.g. "NVDA" |
| company_name | text | e.g. "NVIDIA" |
| latest_price | numeric, nullable | |
| price_updated_at | timestamptz | |
| created_at | timestamptz | |

### post_stocks (many-to-many)
| Column | Type | Notes |
|--------|------|-------|
| id | uuid, PK | |
| post_id | uuid, FK → posts | |
| stock_id | uuid, FK → stocks | |
| mention_type | text | "cashtag" or "keyword" |
| | UNIQUE(post_id, stock_id) | |

### price_history
| Column | Type | Notes |
|--------|------|-------|
| id | uuid, PK | |
| stock_id | uuid, FK → stocks | |
| date | date | |
| open | numeric | |
| high | numeric | |
| low | numeric | |
| close | numeric | |
| volume | bigint | |
| | UNIQUE(stock_id, date) | |

### keyword_mappings
| Column | Type | Notes |
|--------|------|-------|
| id | uuid, PK | |
| keyword | text, unique | e.g. "nvidia", "英伟达" |
| stock_id | uuid, FK → stocks | |

## 5. Backend Logic

### 5.1 Cron Jobs

| Job | Frequency | Action |
|-----|-----------|--------|
| Fetch posts | Every 6 hours | Iterate active bloggers, pull incremental posts, identify stocks, persist, trigger Telegram |
| Sync daily bars | Once daily after 16:30 ET | Pull Yahoo Finance daily OHLCV for all tracked stocks into price_history |
| Update latest price | Every 6 hours | Update stocks.latest_price for list display |

### 5.2 Post Fetch Flow

```
Cron triggers
  → iterate bloggers (is_active = true)
  → for each blogger:
      call TwitterAPI.io GET /user/tweets
        params: username, since = last_fetched_at
  → for each post:
      1. Extract $CASHTAG via regex /\$([A-Z]{1,5})\b/g
      2. Match keywords via keyword_mappings table (case-insensitive)
      3. Dedup by x_post_id (skip if exists)
      4. Insert into posts + post_stocks
      5. If new mention found → send Telegram notification
  → update blogger.last_fetched_at = now()
```

### 5.3 Stock Identification

Two-layer identification, decreasing confidence:

1. **$CASHTAG** (high confidence): regex `/\$([A-Z]{1,5})\b/g`, direct ticker mapping
2. **Keyword match** (medium confidence): lowercase post text, match against keyword_mappings table

Unknown tickers (e.g. `$XYZ` not in stocks table) → auto-create stock record, backfill price data in background.

### 5.4 Telegram Notification

```
Trigger: new stock mention persisted successfully

Message format:
──────────────────
📌 New mention: $NVDA ($215.33)
👤 @hedgeye · 2026-05-24 14:30

"NVDA looking strong heading into earnings,
added to my core position..."

🔗 Original post link
──────────────────
```

- Telegram Bot API, one Bot + one Channel/Group
- All shared users join the same Channel to receive pushes
- Config via env vars: TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID

### 5.5 Yahoo Finance Price Data

- Use `yahoo-finance2` npm package (free, no API key)
- Daily bars: pull after 16:30 ET each day
- Historical backfill: on first stock creation, pull 6 months of daily bars
- Latest price: update stocks.latest_price every 6 hours

## 6. Frontend Design

Reference: Serenity Signal Ledger screenshot layout.

### 6.1 Page Layout

```
┌─────────────────────────────────────────────────────────────┐
│  HEADER: Project name + stats cards                          │
│  [Total Posts] [Stocks] [Bloggers] [Last Updated]            │
├──────────────┬──────────────────────────────────────────────┤
│  LEFT SIDEBAR│              MAIN CONTENT                     │
│  250px       │                                               │
│              │  ┌────────────────────────────────────────┐   │
│  Blogger List│  │  Price Chart + Mention Markers          │   │
│  @user1 🔴   │  │  (TradingView Lightweight Charts)      │   │
│  @user2 🔵   │  │  colored dots per blogger on curve      │   │
│  @user3 🟢   │  └────────────────────────────────────────┘   │
│  (API添加)    │                                               │
│              │  ┌────────────────────────────────────────┐   │
│  Stock List  │  │  Post Timeline                          │   │
│  NVDA  8     │  │  click marker → scroll to post          │   │
│  TSM   5     │  │  color dot + blogger + time + content   │   │
│  AAPL  3     │  └────────────────────────────────────────┘   │
├──────────────┴──────────────────────────────────────────────┤
│  BOTTOM: Latest Opinion Tape (horizontal scroll)             │
└─────────────────────────────────────────────────────────────┘
```

### 6.2 Component Details

**Header Stats Bar** — 4 metric cards with large numbers, light card style

**Left Sidebar — Blogger List**
- Each row: avatar + username + color dot
- Click blogger → filter chart to show only that blogger's markers
- MVP: bloggers are added via API endpoint (`POST /api/bloggers` with CRON_SECRET auth), no UI button
- Future: add `[+ Add Blogger]` button with admin auth

**Left Sidebar — Stock List**
- Sorted by mention count descending
- Each row: ticker + mention count + latest price
- Filter tabs: All / Has Price / High Frequency (≥3 mentions)
- Click stock → main area loads that stock's price chart

**Main — Price Chart**
- TradingView Lightweight Charts
- X-axis: time, Y-axis: price
- Colored circle markers at mention dates (color = blogger's assigned color)
- Hover marker → tooltip with post summary
- Click marker → post timeline scrolls to that post
- Top info: ticker + total mentions + time span + blogger tag list (e.g. `@hedgeye x6  @trader x3`)

**Main — Post Timeline**
- All posts mentioning the selected stock, reverse chronological
- Each post: color dot + blogger name + timestamp + content + original link
- Clicking a chart marker highlights and scrolls to the corresponding post

**Bottom — Latest Opinion Tape**
- Horizontal scroll strip, last 24 hours of all blogger posts
- Not filtered by stock — global latest activity

### 6.3 Visual Style

Following the Serenity Signal Ledger reference:
- **Palette**: warm background (cream/light yellow gradient), dark text
- **Typography**: bold serif for titles, monospace for data
- **Cards**: rounded corners, soft shadows, subtle borders
- **Chart**: dark green price line, colored circle markers

### 6.4 Key Interaction Flows

```
User clicks "NVDA" in stock list
  → Main area loads NVDA price chart
  → Chart shows all bloggers' mention markers (each in their color)
  → Post timeline shows all posts mentioning NVDA

User hovers a 🔴 marker on chart
  → Tooltip: "@hedgeye · 05/24 · NVDA looking strong..."

User clicks that marker
  → Post timeline scrolls to that post, highlights it

User clicks "@hedgeye" in blogger list
  → Chart dims other bloggers' markers, keeps only hedgeye's
  → Post timeline filters to hedgeye's posts only
```

## 7. Project Structure

```
stock/
├── prisma/
│   └── schema.prisma
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   └── api/
│   │       ├── cron/
│   │       │   ├── fetch-posts/route.ts
│   │       │   ├── sync-prices/route.ts
│   │       │   └── update-latest/route.ts
│   │       ├── bloggers/route.ts
│   │       ├── stocks/route.ts
│   │       ├── stocks/[ticker]/route.ts
│   │       └── posts/route.ts
│   ├── components/
│   │   ├── Header.tsx
│   │   ├── BloggerList.tsx
│   │   ├── StockList.tsx
│   │   ├── PriceChart.tsx
│   │   ├── PostTimeline.tsx
│   │   └── OpinionTape.tsx
│   ├── lib/
│   │   ├── twitter.ts
│   │   ├── yahoo.ts
│   │   ├── telegram.ts
│   │   ├── stock-identifier.ts
│   │   └── db.ts
│   └── data/
│       └── keywords.json
├── .env
├── package.json
└── railway.json
```

## 8. Environment Variables

```
DATABASE_URL=           # Supabase PostgreSQL connection string
TWITTER_API_KEY=        # TwitterAPI.io API key
TELEGRAM_BOT_TOKEN=     # Telegram Bot token
TELEGRAM_CHAT_ID=       # Push target channel/group ID
CRON_SECRET=            # Shared secret for cron endpoints and admin API (Authorization: Bearer <secret>)
```

## 9. MVP Scope vs Future

| | MVP (v1) | Future |
|--|----------|--------|
| Bloggers | Admin adds manually via DB/API | Frontend management UI |
| Users | No auth, public read-only | Supabase Auth, per-user spaces |
| Stock ID | $CASHTAG + preset keyword table | Add LLM semantic analysis |
| Notifications | Single Telegram Channel | Per-user notification preferences |
| Charts | Daily bars | Add intraday, technical indicators |
