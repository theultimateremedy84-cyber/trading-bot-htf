# ICT Trading Bot

A fully autonomous trading bot implementing Inner Circle Trader (ICT) / Smart Money Concepts strategy, connected to Capital.com. Includes a live React dashboard for monitoring.

## Features

- **ICT Strategy Engine**: Market structure (BOS/ChoCH), Order Blocks, Fair Value Gaps, Liquidity Sweeps
- **Kill Zone Filter**: Trades only during London (02:00–05:00 UTC) and New York (12:00–15:00 UTC) sessions
- **Risk Management**: 1% risk per trade, configurable max open trades, daily loss limit
- **Markets**: BTC/USD, ETH/USD, EUR/USD, GBP/USD, USD/JPY, Gold, Silver, AUD/USD
- **Live Dashboard**: Real-time positions, signals, P&L, performance analytics
- **Capital.com Integration**: Full REST API with session management

---

## Quick Start (Railway)

### 1. Fork & Clone

```bash
git clone https://github.com/YOUR_USERNAME/trading-bot.git
cd trading-bot
```

### 2. Deploy to Railway

1. Go to [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo**
2. Select your forked repo
3. Add a **PostgreSQL** database service in the same project
4. Set environment variables (see below)

### 3. Set Environment Variables on Railway

In your Railway project → **Variables**, add:

| Variable | Value |
|---|---|
| `DATABASE_URL` | auto-set by Railway PostgreSQL |
| `SESSION_SECRET` | any random 32+ character string |
| `CAPITAL_API_KEY` | from Capital.com settings |
| `CAPITAL_IDENTIFIER` | your Capital.com email |
| `CAPITAL_PASSWORD` | your Capital.com password |
| `CAPITAL_API_URL` | `https://api-capital.backend.gbaaservice.com` (live) |
| `PORT` | `5000` |
| `NODE_ENV` | `production` |

> **Start with Demo**: Use `https://demo-api-capital.backend.gbaaservice.com` for `CAPITAL_API_URL` to test with paper money first.

### 4. Get Capital.com API Key

1. Log into [Capital.com](https://capital.com)
2. Go to **Settings** → **API Management** → **Generate API Key**
3. Copy the key and paste into Railway variables

### 5. Configure the Bot

Once deployed, open the dashboard and go to **Settings**:
- Enter your Capital.com API Key, email, and password
- Set Live/Demo toggle
- Configure risk parameters
- Enable/disable markets and kill zones

### 6. Start the Bot

Click the **START** button on the dashboard. The bot will:
1. Authenticate with Capital.com
2. Begin scanning markets every 5 minutes
3. Generate ICT signals and execute trades automatically

---

## Local Development

```bash
# Install dependencies
pnpm install

# Set up environment
cp .env.example .env
# Fill in your .env values

# Push database schema
pnpm --filter @workspace/db run push

# Start API server
pnpm --filter @workspace/api-server run dev

# Start dashboard (separate terminal)
pnpm --filter @workspace/dashboard run dev
```

---

## ICT Strategy Overview

The bot uses a multi-timeframe approach:

| Timeframe | Purpose |
|---|---|
| H4 | HTF bias (BULLISH/BEARISH) |
| H1 | Intermediate market structure (BOS/ChoCH) |
| M15 | Entry signals (Order Blocks, FVGs, Liquidity Sweeps) |

**Signal confidence scoring:**
- HTF Bias alignment: +30 pts
- Kill Zone active: +20 pts
- Order Block: +10 pts
- Fair Value Gap: +10 pts
- Liquidity Sweep: +15 pts
- BOS confirmation: +8 pts
- ChoCH confirmation: +7 pts

Default minimum confidence: **65/100** (configurable)

---

## Risk Management

- **1% risk per trade** (default, configurable)
- **Max 3 open trades** simultaneously
- **3% daily loss limit** — bot stops trading for the day if breached
- **Minimum 2:1 R:R ratio** — only enters trades with at least 2x reward vs risk
- Position size calculated automatically based on stop distance

---

## Architecture

```
├── artifacts/
│   ├── api-server/          # Express API + trading bot engine
│   │   └── src/
│   │       ├── lib/
│   │       │   ├── capitalApi.ts    # Capital.com REST client
│   │       │   ├── ictStrategy.ts   # ICT strategy engine
│   │       │   ├── riskManager.ts   # Position sizing & risk
│   │       │   └── botRunner.ts     # Main bot loop
│   │       └── routes/              # REST API endpoints
│   └── dashboard/           # React + Vite dashboard
├── lib/
│   ├── api-spec/            # OpenAPI spec (source of truth)
│   ├── api-client-react/    # Generated React Query hooks
│   ├── api-zod/             # Generated Zod schemas
│   └── db/                  # Drizzle ORM schema & client
└── railway.toml             # Railway deployment config
```

---

## ⚠️ Risk Warning

This bot trades real money autonomously. Past performance is not indicative of future results. Always:
- Test with a **demo account** before going live
- Start with small position sizes
- Monitor the dashboard regularly
- Set a conservative daily loss limit
