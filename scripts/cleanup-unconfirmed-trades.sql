-- ============================================================
-- Trading Bot — Historical Ghost Trade Cleanup
-- ============================================================
-- Run this ONCE on your Railway PostgreSQL database to remove
-- trade records that were inserted before the ACCEPTED-status
-- check was added to botRunner.ts.
--
-- These "ghost" records correspond to orders that Capital.com
-- rejected or left in OPEN/PENDING state, but the old code
-- inserted them into the DB as if they were real trades.
-- They inflate the trade count and corrupt win-rate stats.
--
-- HOW TO RUN:
--   Railway dashboard → your PostgreSQL service → Connect tab
--   Paste and run step by step. Never run the DELETE without
--   reviewing the SELECT output first.
--
-- ============================================================

-- ── STEP 1: Preview what will be removed ─────────────────────
-- Trades with no deal_id were never confirmed by Capital.com.
-- (The old code sometimes inserted without a dealId on error.)
SELECT
  id,
  epic,
  direction,
  size,
  entry_price,
  entry_date,
  strategy,
  result,
  exit_date
FROM trades
WHERE deal_id IS NULL
   OR deal_id = ''
ORDER BY entry_date DESC;

-- ── STEP 2: Preview open trades that may be ghosts ───────────
-- Trades with result IS NULL and exit_date IS NULL have never
-- been matched to a real Capital.com position. If Capital.com
-- shows NO corresponding open position for these, they are ghosts.
-- Cross-check each deal_id against your Capital.com trade history
-- before deleting.
SELECT
  id,
  deal_id,
  epic,
  direction,
  size,
  entry_price,
  entry_date,
  strategy
FROM trades
WHERE result IS NULL
  AND exit_date IS NULL
ORDER BY entry_date DESC;

-- ── STEP 3: Delete trades with no deal_id (safe to auto-delete)
-- These were never placed on Capital.com — safe to remove.
-- UNCOMMENT when ready:
-- DELETE FROM trades WHERE deal_id IS NULL OR deal_id = '';

-- ── STEP 4: Delete specific ghost trade IDs ──────────────────
-- After reviewing STEP 2, list the IDs of confirmed ghost trades
-- (those not found in Capital.com history) and delete them here.
-- Replace the IDs below with your actual ghost trade IDs.
-- UNCOMMENT and fill in IDs when ready:
-- DELETE FROM trades WHERE id IN (/* comma-separated IDs here */);

-- ── STEP 5: Verify the count ─────────────────────────────────
SELECT
  COUNT(*) FILTER (WHERE result IS NULL AND exit_date IS NULL)  AS open_trades,
  COUNT(*) FILTER (WHERE result = 'WIN')                        AS wins,
  COUNT(*) FILTER (WHERE result = 'LOSS')                       AS losses,
  COUNT(*) FILTER (WHERE result = 'BREAKEVEN')                  AS breakevens,
  COUNT(*)                                                       AS total
FROM trades;
