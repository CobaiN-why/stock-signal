# Stock Signal Dashboard

Multi-blogger stock mention tracker. Tracks X (Twitter) bloggers, extracts stock mentions, displays price charts with mention markers, pushes to Telegram.

## Tech Stack

- **Framework**: Next.js 15 (App Router, TypeScript)
- **Database**: Supabase PostgreSQL via Prisma ORM
- **Charts**: TradingView Lightweight Charts
- **Styling**: Tailwind CSS
- **External APIs**: TwitterAPI.io, Yahoo Finance, Telegram Bot API
- **Hosting**: Railway

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
├── app/              # Next.js App Router pages & API routes
│   ├── api/          # Backend endpoints
│   │   ├── cron/     # Scheduled jobs (fetch-posts, sync-prices, update-latest)
│   │   ├── bloggers/ # Blogger CRUD
│   │   ├── stocks/   # Stock list & detail
│   │   ├── posts/    # Post queries
│   │   └── stats/    # Dashboard stats
│   ├── layout.tsx    # Global layout
│   └── page.tsx      # Dashboard page
├── components/       # React components
├── lib/              # Backend utilities (twitter, yahoo, telegram, stock-identifier)
└── data/             # Static data (keywords.json)
```

## Conventions

- All API routes under `src/app/api/`
- All shared utilities under `src/lib/`
- Cron endpoints require `Authorization: Bearer <CRON_SECRET>` header
- Database access only through Prisma client (`src/lib/db.ts`)
- Environment variables defined in `.env.example`

## Design Spec

Full spec at `docs/superpowers/specs/2026-05-24-stock-signal-dashboard-design.md`
