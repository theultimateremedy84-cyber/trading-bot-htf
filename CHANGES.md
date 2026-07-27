# Bug Fix Patch — Trading Bot HTF

This zip contains **only the changed files**. Place each file at the path shown below, relative to your repo root.

---

## Files changed

```
artifacts/api-server/src/routes/signals.ts          ← new GET /signals/:id endpoint
artifacts/api-server/src/lib/capitalApi.ts           ← expanded DealConfirmation type
artifacts/api-server/src/lib/botRunner.ts            ← fix monitorPositions + entry price
artifacts/dashboard/src/App.tsx                      ← new /signals/:id route
artifacts/dashboard/src/pages/dashboard.tsx          ← fix win rate double-multiply bug
artifacts/dashboard/src/pages/signals.tsx            ← cards now clickable with chevron
artifacts/dashboard/src/pages/signal-detail.tsx      ← NEW page (full signal breakdown)
lib/api-spec/openapi.yaml                            ← new /signals/{id} path + SignalDetail schema
scripts/cleanup-unconfirmed-trades.sql               ← one-time DB cleanup guide
```

---

## What was fixed

### 1 — Clickable signals with full detail page
**Files:** `signals.ts` (backend), `signals.tsx`, `dashboard.tsx`, `signal-detail.tsx`, `App.tsx`

Clicking any signal card (in either the Signals feed or the Dashboard's Recent Signals panel)
now navigates to `/signals/:id`, which shows:
- Trade parameters (entry, stop, TP, R:R)
- Multi-timeframe alignment grid (Monthly → M15)
- HTF gate decision explanation
- HTF order-flow detail per timeframe (BOS, ChoCH, OB levels, HH/HL pattern)
- Confidence score breakdown — every scoring factor (+45 all aligned, +15 kill zone,
  +12 liquidity sweep, +10 OB, +8 BOS, +7 FVG, +5 ChoCH, +3 OB+FVG combo,
  −15 H4 counter-trend) shown with active/inactive state and the points it contributed
- Entry-timeframe analysis (OB/FVG/sweep counts, confluences, H4 counter-trend warning)

### 2 — Win rate showing incorrectly on dashboard
**File:** `dashboard.tsx` line ~79

`performance.winRate` is already a percentage (e.g. `65` = 65%). The dashboard card
was multiplying it by 100 again (`performance.winRate * 100`), producing values like
`+6500.00%`. The Performance page was always correct; only the dashboard summary card
had this bug. **One-line fix.**

### 3 — Trade count inflated vs Capital.com
Three separate root causes, each addressed:

**3a — monitorPositions() fetched positions once per trade** (`botRunner.ts`)  
`getPositions()` was called inside the per-trade loop. If it returned an empty array
(rate limit, session expiry, network blip), every trade in that loop was immediately
marked CLOSED. Now it fetches once before the loop and aborts the entire cycle on error —
no trade is ever closed based on a failed API call.

**3b — Entry price mismatch** (`capitalApi.ts`, `botRunner.ts`)  
The `DealConfirmation` interface now captures `level` (Capital.com's actual fill price)
and `size`. The bot now records `confirmation.level` as `entryPrice` in the DB instead
of the strategy's pre-calculated price. This eliminates the P&L mismatch between the
dashboard and Capital.com.

**3c — Historical ghost records** (`scripts/cleanup-unconfirmed-trades.sql`)  
Before the ACCEPTED-status check was added, trades were inserted regardless of whether
Capital.com accepted them. Run the cleanup SQL to identify and remove ghost records.
It includes preview queries and safe, guided DELETE statements — read it before running.

---

## After applying

1. Commit and push the changed files.
2. Railway will redeploy automatically.
3. Run the cleanup SQL (step by step) against your Railway PostgreSQL instance to
   remove any historical ghost trade records.
4. **Optionally re-run codegen** (`pnpm --filter @workspace/api-spec run codegen`)
   to regenerate the API client from the updated OpenAPI spec. The `signal-detail.tsx`
   page fetches `/api/signals/:id` directly and does not require codegen to work.
