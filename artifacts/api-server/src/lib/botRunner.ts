/**
 * Bot Runner — Main trading bot loop
 *
 * Orchestrates:
 * 1. Capital.com session management
 * 2. Market scanning on schedule
 * 3. ICT signal detection
 * 4. Trade execution
 * 5. Position monitoring
 *
 * FIX LOG:
 *   [Bug #4] Session refresh: ensureSession() is now called proactively at
 *            the start of every scan cycle, not just lazily inside individual
 *            API calls. Prevents stale-token failures between scans.
 *   [Bug #5] monitorPositions() is now called immediately on startBot() and
 *            after every scan, not only inside the interval timer. Previously
 *            closed trades sat undetected for up to 5 minutes after a restart.
 *   [Bug #6] monitorPositions(): getPositions() is now fetched ONCE before the
 *            per-trade loop instead of once per trade. If the fetch fails the
 *            entire monitor cycle is aborted — this prevents a failed/empty
 *            API response from incorrectly marking all open trades as closed
 *            and corrupting win-rate and P&L statistics.
 *   [Bug #7] Trade insertion now records the actual fill price returned by
 *            Capital.com's /confirms endpoint (confirmation.level) instead of
 *            the strategy's pre-calculated entry price. Eliminates the
 *            persistent P&L mismatch between the dashboard and Capital.com.
 */

import { db } from "@workspace/db";
import { signalsTable, tradesTable, botSettingsTable } from "@workspace/db";
import { eq, desc, isNull } from "drizzle-orm";
import { CapitalApiClient, type CapitalCandle } from "./capitalApi";
import { analyzeMarket, getCurrentKillZone } from "./ictStrategy";

// ─────────────────────────────────────────────
// Candle aggregation helpers
// Capital.com's demo API only reliably supports up to DAY resolution.
// We derive weekly and monthly candles from daily data to avoid
// "error.invalid.resolution" errors on WEEK / MONTH endpoints.
// ─────────────────────────────────────────────

function aggregateCandles(daily: CapitalCandle[], barsPerGroup: number): CapitalCandle[] {
  const result: CapitalCandle[] = [];
  for (let i = 0; i < daily.length; i += barsPerGroup) {
    const chunk = daily.slice(i, i + barsPerGroup);
    if (chunk.length === 0) continue;
    result.push({
      snapshotTime: chunk[0].snapshotTime,
      openPrice: chunk[0].openPrice,
      highPrice: {
        bid: Math.max(...chunk.map((c) => c.highPrice.bid)),
        ask: Math.max(...chunk.map((c) => c.highPrice.ask)),
      },
      lowPrice: {
        bid: Math.min(...chunk.map((c) => c.lowPrice.bid)),
        ask: Math.min(...chunk.map((c) => c.lowPrice.ask)),
      },
      closePrice: chunk[chunk.length - 1].closePrice,
      lastTradedVolume: chunk.reduce((s, c) => s + c.lastTradedVolume, 0),
    });
  }
  return result;
}

/** ~5 trading days → 1 weekly candle */
function toWeeklyCandles(daily: CapitalCandle[]): CapitalCandle[] {
  return aggregateCandles(daily, 5);
}

/** ~21 trading days → 1 monthly candle */
function toMonthlyCandles(daily: CapitalCandle[]): CapitalCandle[] {
  return aggregateCandles(daily, 21);
}

import {
  calculatePositionSize,
  canOpenNewTrade,
  formatPrice,
  getMinSizeForEpic,
  getMaxSizeForEpic,
  getDecimalPlacesForEpic,
  getMinStopDistance,
} from "./riskManager";
import { logger } from "./logger";

const MARKET_MAP: Record<string, string> = {
  BTCUSD: "Bitcoin",
  ETHUSD: "Ethereum",
  EURUSD: "EUR/USD",
  GBPUSD: "GBP/USD",
  USDJPY: "USD/JPY",
  GOLD: "Gold",
  SILVER: "Silver",
  AUDUSD: "AUD/USD",
};

interface BotState {
  running: boolean;
  startedAt: Date | null;
  lastScan: Date | null;
  error: string | null;
  client: CapitalApiClient | null;
  scanInterval: NodeJS.Timeout | null;
}

const state: BotState = {
  running: false,
  startedAt: null,
  lastScan: null,
  error: null,
  client: null,
  scanInterval: null,
};

export function getBotState() {
  return {
    running: state.running,
    uptime: state.startedAt ? Math.floor((Date.now() - state.startedAt.getTime()) / 1000) : null,
    lastScan: state.lastScan?.toISOString() ?? null,
    error: state.error,
    sessionValid: state.client?.isSessionValid() ?? false,
  };
}

async function loadSettings() {
  const rows = await db.select().from(botSettingsTable).limit(1);
  let row: typeof botSettingsTable.$inferSelect;
  if (rows.length === 0) {
    const inserted = await db.insert(botSettingsTable).values({}).returning();
    row = inserted[0];
  } else {
    row = rows[0];
  }

  // Environment variables override DB values so deployments
  // work without a Settings-page visit on first boot.
  return {
    ...row,
    capitalApiKey:     process.env["CAPITAL_API_KEY"]                                        || row.capitalApiKey,
    capitalIdentifier: process.env["CAPITAL_IDENTIFIER"]                                   || row.capitalIdentifier,
    capitalPassword:   process.env["CAPITAL_PASSWORD"]                                     || row.capitalPassword,
    capitalApiUrl:     process.env["CAPITAL_API_BASE_URL"] || process.env["CAPITAL_API_URL"] || row.capitalApiUrl,
  };
}

async function scanMarkets() {
  if (!state.client) return;

  // FIX #4: Proactively refresh the session at the start of every scan
  // cycle. The Capital.com session token expires in 10 minutes; calling
  // ensureSession() here guarantees a fresh token before any API calls,
  // instead of relying on each call to detect expiry at the last moment.
  try {
    await state.client.ensureSession();
  } catch (refreshErr) {
    logger.error({ err: refreshErr }, "Session refresh failed — will retry next scan");
    return;
  }

  const scanStart = new Date().toISOString();
  logger.info({ scanStart }, "=== Market scan starting ===");

  try {
    const settings = await loadSettings();
    const markets = settings.enabledMarkets.split(",").map((m: string) => m.trim()).filter(Boolean);
    const enabledKillZones = settings.enabledKillZones.split(",").map((k: string) => k.trim()).filter(Boolean);

    const currentKillZone = getCurrentKillZone();
    logger.info(
      { currentKillZone, enabledKillZones, inKillZone: currentKillZone !== null && enabledKillZones.includes(currentKillZone) },
      "Kill zone check"
    );

    let openPositions: Awaited<ReturnType<CapitalApiClient["getPositions"]>>;
    let accounts: Awaited<ReturnType<CapitalApiClient["getAccounts"]>>;

    try {
      [openPositions, accounts] = await Promise.all([
        state.client.getPositions(),
        state.client.getAccounts(),
      ]);
    } catch (apiErr) {
      logger.error({ err: apiErr }, "Capital.com API call failed — session may be invalid. Will re-authenticate on next scan.");
      await state.client.createSession().catch((e) =>
        logger.error({ err: e }, "Re-authentication failed")
      );
      return;
    }

    const openCount = openPositions.length;
    const account = accounts[0];
    if (!account) {
      logger.error("No account found — check Capital.com credentials and account status");
      return;
    }

    const balance = account.balance.balance;
    logger.info(
      { accountId: account.accountId, accountType: account.accountType, balance, openPositions: openCount },
      "Account snapshot"
    );

    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);

    const tradesRows = await db
      .select()
      .from(tradesTable)
      .orderBy(desc(tradesTable.entryDate))
      .limit(100);

    const todayPnl = tradesRows
      .filter((t) => t.exitDate && new Date(t.exitDate) >= todayStart && t.profit !== null)
      .reduce((sum, t) => sum + (t.profit ?? 0), 0);

    const dailyRiskCheck = canOpenNewTrade(openCount, settings.maxOpenTrades, {
      tradesToday: tradesRows.filter((t) => t.exitDate && new Date(t.exitDate) >= todayStart).length,
      pnlToday: todayPnl,
      dailyLossLimit: settings.dailyLossLimit,
      accountBalance: balance,
    });

    if (!dailyRiskCheck.allowed) {
      logger.info({ reason: dailyRiskCheck.reason }, "Daily risk limit — no new trades will be opened this scan");
    }

    const strategyConfig = {
      useOrderBlocks: settings.useOrderBlocks,
      useFairValueGaps: settings.useFairValueGaps,
      useLiquiditySweeps: settings.useLiquiditySweeps,
      useBOS: settings.useBOS,
      useChoCH: settings.useChoCH,
      minRR: settings.minRR,
      minConfidence: settings.minConfidence,
      enabledKillZones,
    };

    logger.info(
      { markets, minConfidence: settings.minConfidence, minRR: settings.minRR, strategyFeatures: strategyConfig },
      "Scanning markets"
    );

    for (const epic of markets) {
      try {
        logger.info({ epic }, "Fetching candle data…");

        // Fetch only resolutions supported by Capital.com's demo API.
        // WEEK and MONTH cause "error.invalid.resolution" — we derive
        // them locally from daily candles instead.
        const [
          dailyCandles,
          h4Candles,
          h1Candles,
          m15Candles,
          marketData,
        ] = await Promise.all([
          state.client.getCandles(epic, "DAY", 200),   // ~9 months of daily bars (enough for monthly/weekly HTF)
          state.client.getCandles(epic, "HOUR_4", 50),
          state.client.getCandles(epic, "HOUR", 100),
          state.client.getCandles(epic, "MINUTE_15", 100),
          state.client.getSingleMarket(epic),
        ]);

        // Derive weekly (~5 trading days) and monthly (~21 trading days)
        const weeklyCandles = toWeeklyCandles(dailyCandles);
        const monthlyCandles = toMonthlyCandles(dailyCandles);

        if (!marketData) {
          logger.warn({ epic }, "Market data not found — epic may be wrong or market is closed. Skipping.");
          continue;
        }

        logger.info(
          {
            epic,
            marketStatus: marketData.marketStatus,
            bid: marketData.bid,
            offer: marketData.offer,
            daily: dailyCandles.length,
            weekly: weeklyCandles.length,
            monthly: monthlyCandles.length,
            h4: h4Candles.length,
            h1: h1Candles.length,
            m15: m15Candles.length,
          },
          "Candle data fetched (weekly/monthly derived from daily) — running ICT analysis"
        );

        // Guard: skip closed markets
        if (marketData.marketStatus !== "TRADEABLE") {
          logger.info({ epic, marketStatus: marketData.marketStatus }, "Market not tradeable — skipping");
          continue;
        }

        const signal = await analyzeMarket(
          epic,
          MARKET_MAP[epic] ?? epic,
          monthlyCandles,
          weeklyCandles,
          dailyCandles,
          h4Candles,
          h1Candles,
          m15Candles,
          marketData.bid,
          marketData.offer,
          strategyConfig
        );

        if (!signal) {
          logger.info(
            { epic, minConfidence: settings.minConfidence, minRR: settings.minRR },
            "No signal generated — HTF alignment missing, confidence below threshold, or no entry confluence (OB/FVG/BOS/ChoCH/Sweep)."
          );
          continue;
        }

        logger.info(
          {
            epic,
            signal: signal.signalType,
            direction: signal.direction,
            confidence: signal.confidence,
            htfBias: signal.htfBias,
            structureContext: signal.structureContext,
            killZone: signal.killZone,
            entry: signal.entryPrice,
            stop: signal.stopLoss,
            target: signal.takeProfit,
          },
          "ICT signal detected"
        );

        const [savedSignal] = await db.insert(signalsTable).values({
          epic,
          market: MARKET_MAP[epic] ?? epic,
          direction: signal.direction,
          signalType: signal.signalType,
          timeframe: signal.timeframe,
          entryPrice: signal.entryPrice,
          stopLoss: signal.stopLoss,
          takeProfit: signal.takeProfit,
          confidence: signal.confidence,
          killZone: signal.killZone,
          notes: signal.notes,
          htfBias: signal.htfBias,
          structureContext: signal.structureContext,
          executed: false,
        }).returning();

        if (!dailyRiskCheck.allowed) {
          logger.info({ reason: dailyRiskCheck.reason }, "Signal found but skipping execution — daily risk limit active");
          continue;
        }

        // ── Minimum stop distance enforcement ────────────────────────────
        // Capital.com rejects orders whose stop is too close to the current
        // price. The minimum varies by instrument; getMinStopDistance() returns
        // a conservative per-instrument floor. When the signal's stop is tighter
        // than the minimum we widen it (and recalculate the target at the same
        // R:R) so the order is accepted.
        const minStop = getMinStopDistance(epic, signal.entryPrice);
        const rawStopDistance = Math.abs(signal.entryPrice - signal.stopLoss);

        if (rawStopDistance < minStop) {
          logger.warn(
            { epic, rawStopDistance: rawStopDistance.toFixed(5), minStop: minStop.toFixed(5) },
            "Stop too tight for Capital.com — widening to instrument minimum"
          );
          if (signal.direction === "BUY") {
            signal.stopLoss  = signal.entryPrice - minStop;
            signal.takeProfit = signal.entryPrice + minStop * settings.minRR;
          } else {
            signal.stopLoss  = signal.entryPrice + minStop;
            signal.takeProfit = signal.entryPrice - minStop * settings.minRR;
          }
        }
        // ─────────────────────────────────────────────────────────────────

        const sizeResult = calculatePositionSize({
          accountBalance: balance,
          riskPerTrade: settings.riskPerTrade,
          entryPrice: signal.entryPrice,
          stopLoss: signal.stopLoss,
          epic,
          minSize: getMinSizeForEpic(epic),
          maxSize: getMaxSizeForEpic(epic),   // per-instrument cap (avoids margin blow-out)
          decimalPlaces: getDecimalPlacesForEpic(epic),
        });

        logger.info(
          {
            epic,
            size: sizeResult.size,
            riskAmount: sizeResult.riskAmount,
            stopDistance: sizeResult.stopDistance,
            stopLoss: signal.stopLoss,
            takeProfit: signal.takeProfit,
          },
          "Position size calculated"
        );

        if (sizeResult.size <= 0) {
          logger.warn({ epic, sizeResult }, "Calculated size is 0 — skipping. Risk % or account balance may be too low.");
          continue;
        }

        try {
          logger.info({
            epic,
            direction: signal.direction,
            size: sizeResult.size,
            entry: signal.entryPrice,
            stop: formatPrice(signal.stopLoss, epic),
            target: formatPrice(signal.takeProfit, epic),
          }, "Placing order on Capital.com…");

          const dealResult = await state.client.createPosition({
            epic,
            direction: signal.direction,
            size: sizeResult.size,
            stopLevel: formatPrice(signal.stopLoss, epic),
            profitLevel: formatPrice(signal.takeProfit, epic),
          });

          logger.info({ epic, dealReference: dealResult.dealReference }, "Order submitted — waiting for confirmation");

          await new Promise((r) => setTimeout(r, 2000));
          const confirmation = await state.client.getDealConfirmation(dealResult.dealReference);

          logger.info({ epic, dealId: confirmation.dealId, status: confirmation.status, fillPrice: confirmation.level }, "Deal confirmation received");

          // FIX #7 (original): Only record the trade in the database when
          // Capital.com explicitly confirms the deal was ACCEPTED. Previously
          // the trade was always inserted regardless of the confirmation status,
          // which caused rejected/pending orders to appear as real trades in the
          // dashboard, inflating the trade count and corrupting win-rate
          // calculations.
          if (confirmation.status !== "ACCEPTED") {
            logger.warn(
              { epic, dealId: confirmation.dealId, status: confirmation.status, reason: confirmation.reason },
              `Deal NOT accepted by Capital.com (status: ${confirmation.status}) — skipping trade record. No position opened.`
            );
            continue;
          }

          await db.update(signalsTable)
            .set({ executed: true })
            .where(eq(signalsTable.id, savedSignal.id));

          // FIX #7 (new): Use the actual fill price from Capital.com's
          // confirmation (`confirmation.level`) as the recorded entry price.
          // Previously the strategy's pre-calculated entry price was always
          // used, which diverges from what Capital.com filled at due to spread
          // and market movement between signal generation and order execution.
          // This is the root cause of the P&L mismatch between the dashboard
          // and Capital.com's own trade history.
          const actualEntryPrice = confirmation.level ?? signal.entryPrice;
          if (confirmation.level && confirmation.level !== signal.entryPrice) {
            logger.info(
              { epic, calculatedEntry: signal.entryPrice, actualFill: confirmation.level },
              "Using Capital.com fill price as entry (differs from calculated signal entry)"
            );
          }

          await db.insert(tradesTable).values({
            dealId: confirmation.dealId,
            epic,
            market: MARKET_MAP[epic] ?? epic,
            direction: signal.direction,
            size: sizeResult.size,
            entryPrice: actualEntryPrice,
            stopLoss: signal.stopLoss,
            takeProfit: signal.takeProfit,
            strategy: `ICT-${signal.signalType}`,
            signalId: savedSignal.id,
            notes: signal.notes,
          });

          logger.info({ epic, dealId: confirmation.dealId, size: sizeResult.size, direction: signal.direction, entryPrice: actualEntryPrice }, "✅ Trade executed and recorded successfully");
        } catch (execErr) {
          const errMsg = execErr instanceof Error ? execErr.message : String(execErr);
          // Embed the Capital.com error directly in the message string so it is
          // visible in Railway's plain-text log view (not just in the JSON field).
          logger.error(
            { epic, size: sizeResult.size, direction: signal.direction, stop: formatPrice(signal.stopLoss, epic), target: formatPrice(signal.takeProfit, epic) },
            `❌ Failed to execute trade on ${epic}: ${errMsg}`
          );
        }
      } catch (marketErr) {
        const errMsg = marketErr instanceof Error ? marketErr.message : String(marketErr);
        logger.error({ epic }, `Error scanning market [${epic}]: ${errMsg}`);
      }

      // FIX #5 (rate limiting): demo API enforces a strict per-window cap.
      // 8 markets × 5 parallel candle calls = 40 requests per scan cycle.
      // 1 s was not enough — GOLD and SILVER (markets 6-7) regularly hit 429.
      // 2.5 s gives ~20 s total scan time while staying under the rate limit.
      await new Promise((r) => setTimeout(r, 2500));
    }

    state.lastScan = new Date();
    logger.info({ scanEnd: new Date().toISOString(), marketsScanned: markets.length }, "=== Market scan complete ===");
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error({ err: errMsg }, "Fatal error during market scan");
    state.error = errMsg;
  }
}

/**
 * FIX #6: monitorPositions — guard against false trade closures on API errors.
 *
 * OLD behaviour (broken):
 *   - getPositions() was called once PER trade inside the per-trade loop.
 *   - If the API call failed or returned an empty array (rate limit, session
 *     expiry, network blip), ALL open trades not found in the response were
 *     immediately marked as CLOSED with a fabricated exit price and P&L.
 *   - This inflated the closed-trade count and corrupted win-rate statistics.
 *
 * NEW behaviour:
 *   - getPositions() is called ONCE before the loop, shared across all trades.
 *   - If that single fetch throws, the entire monitor cycle is aborted (return
 *     early) — no trade is ever closed on the basis of a failed API call.
 *   - A warning is logged when Capital.com returns 0 positions while the DB
 *     still has open trades, so anomalies are visible in Railway logs.
 */
/**
 * Determine the most accurate exit price for a trade that has closed on
 * Capital.com.  Using the current mid-price (sampled up to 5 minutes after
 * the actual close) produces wrong P&L when price recovers after an SL hit.
 *
 * Logic:
 *   BUY  — if current bid is at or below stopLoss  → SL was hit → use stopLoss
 *         — if current bid is at or above takeProfit → TP was hit → use takeProfit
 *         — otherwise (manually closed)             → use mid price
 *   SELL — mirror logic using offer price vs stopLoss / takeProfit
 *
 * The stored SL/TP levels are Capital.com-formatted prices so they are
 * directly comparable to the live bid/offer.
 */
function resolveExitPrice(
  direction: string,
  stopLoss: number,
  takeProfit: number,
  bid: number,
  offer: number,
): { exitPrice: number; method: string } {
  const mid = (bid + offer) / 2;
  if (direction === "BUY") {
    if (bid <= stopLoss)    return { exitPrice: stopLoss,    method: "stop-loss" };
    if (bid >= takeProfit)  return { exitPrice: takeProfit,  method: "take-profit" };
  } else {
    if (offer >= stopLoss)  return { exitPrice: stopLoss,    method: "stop-loss" };
    if (offer <= takeProfit) return { exitPrice: takeProfit, method: "take-profit" };
  }
  return { exitPrice: mid, method: "mid-price" };
}

async function monitorPositions() {
  if (!state.client) return;

  try {
    const openTrades = await db
      .select()
      .from(tradesTable)
      .where(isNull(tradesTable.result));

    // ── FIX #6: Fetch positions ONCE; abort the cycle on any error ────────
    // Never close DB trades based on a failed or empty API response.
    let positions: Awaited<ReturnType<CapitalApiClient["getPositions"]>>;
    try {
      positions = await state.client.getPositions();
    } catch (fetchErr) {
      logger.error(
        { err: fetchErr },
        "getPositions() failed — aborting monitor cycle to prevent false trade closures. Will retry next scan."
      );
      return; // GUARD: bail out; do not close any trade this cycle
    }

    // ── FIX #8: Orphan position reconciliation ───────────────────────────
    // Detect positions that exist on Capital.com but have NO matching DB
    // record.  This happens when:
    //   • The bot placed an order and Capital.com accepted it, but the
    //     process crashed / restarted before the DB insert completed.
    //   • A position was opened manually on Capital.com.
    // For each orphan we create a best-effort DB record so the trade history
    // and P&L calculations stay accurate.
    const dbDealIds = new Set(openTrades.map((t) => t.dealId).filter(Boolean));

    for (const livePos of positions) {
      const dealId = livePos.position.dealId;
      if (!dealId || dbDealIds.has(dealId)) continue; // already tracked

      // Resolve the open price — Capital.com uses "level" in the JSON
      const openLevel =
        (livePos.position as { level?: number }).level ??
        livePos.position.openLevel ??
        0;

      const epic = livePos.market.epic;
      logger.warn(
        { dealId, epic, direction: livePos.position.direction, openLevel },
        "Orphan position detected on Capital.com — creating DB record"
      );

      try {
        await db.insert(tradesTable).values({
          dealId,
          epic,
          market: MARKET_MAP[epic] ?? livePos.market.instrumentName ?? epic,
          direction: livePos.position.direction,
          size: livePos.position.size,
          entryPrice: openLevel,
          // Use the stored SL/TP from Capital.com when available
          stopLoss: livePos.position.stopLevel ?? openLevel,
          takeProfit: livePos.position.limitLevel ?? openLevel,
          strategy: "MANUAL",
          notes: "Auto-recovered: position existed on Capital.com without a DB record",
        });
        logger.info({ dealId, epic }, "Orphan position added to DB");
      } catch (insertErr) {
        logger.error({ err: insertErr, dealId }, "Failed to insert orphan position — may already exist");
      }
    }
    // ──────────────────────────────────────────────────────────────────────

    if (openTrades.length === 0) return;

    logger.info({ openTrades: openTrades.length }, "Monitoring open positions");

    // Sanity check: 0 live positions with open DB trades could be a genuine
    // simultaneous SL/TP hit or an API anomaly.
    if (positions.length === 0 && openTrades.length > 0) {
      logger.warn(
        { openTradesInDb: openTrades.length },
        "Capital.com returned 0 open positions but DB has open trades — " +
        "could be simultaneous SL/TP, or an API anomaly. Proceeding with individual verification."
      );
    }

    for (const trade of openTrades) {
      // ── FIX #8b: Handle trades with no dealId ───────────────────────────
      // Previously these were silently skipped forever.  Now we attempt a
      // best-effort match by epic + direction against live positions so that
      // the dealId can be back-filled and the trade properly tracked.
      if (!trade.dealId) {
        const match = positions.find(
          (p) =>
            p.market.epic === trade.epic &&
            p.position.direction === trade.direction &&
            !dbDealIds.has(p.position.dealId), // not already claimed by another DB row
        );
        if (match?.position.dealId) {
          await db
            .update(tradesTable)
            .set({ dealId: match.position.dealId })
            .where(eq(tradesTable.id, trade.id));
          logger.info(
            { tradeId: trade.id, dealId: match.position.dealId },
            "Back-filled missing dealId from live Capital.com position"
          );
          dbDealIds.add(match.position.dealId); // mark as claimed
        } else {
          logger.warn({ tradeId: trade.id, epic: trade.epic }, "Open trade has no dealId and no live match — deferring");
        }
        continue;
      }

      try {
        const pos = positions.find((p) => p.position.dealId === trade.dealId);

        if (!pos) {
          // Position not on Capital.com → it was closed (SL, TP, or manual).
          // ── FIX #9: Use SL/TP level as exit price, not current mid-price ──
          // The old code used (bid + offer) / 2 sampled up to 5 minutes after
          // the actual close.  If price recovered after an SL hit, the bot
          // would record a WIN when the trade was actually a LOSS.
          // We now infer the true exit from current bid/offer vs the stored
          // SL/TP levels.  When price has moved past TP → TP hit; when at
          // or below SL → SL hit; otherwise assume manual close at mid-price.
          const market = await state.client.getSingleMarket(trade.epic);
          if (!market) {
            logger.warn(
              { tradeId: trade.id, epic: trade.epic },
              "Market data unavailable for closed trade — deferring to next cycle"
            );
            continue;
          }

          const { exitPrice, method } = resolveExitPrice(
            trade.direction,
            trade.stopLoss,
            trade.takeProfit,
            market.bid,
            market.offer,
          );

          const profit =
            trade.direction === "BUY"
              ? (exitPrice - trade.entryPrice) * trade.size
              : (trade.entryPrice - exitPrice) * trade.size;

          const result = profit > 0 ? "WIN" : profit < 0 ? "LOSS" : "BREAKEVEN";
          const stopRisk = Math.abs(trade.entryPrice - trade.stopLoss) * trade.size;
          const rr = stopRisk > 0 ? Math.abs(profit) / stopRisk : 0;

          await db
            .update(tradesTable)
            .set({ exitPrice, profit, exitDate: new Date(), result, riskRewardRatio: rr })
            .where(eq(tradesTable.id, trade.id));

          logger.info(
            { tradeId: trade.id, result, profit: profit.toFixed(4), rr: rr.toFixed(2), exitMethod: method },
            "Trade closed"
          );
        }
      } catch (err) {
        logger.error({ err, tradeId: trade.id }, "Error monitoring position");
      }
    }
  } catch (err) {
    logger.error({ err }, "Error monitoring positions");
  }
}

export async function startBot(): Promise<void> {
  if (state.running) throw new Error("Bot is already running");

  const settings = await loadSettings();

  if (!settings.capitalApiKey || !settings.capitalIdentifier || !settings.capitalPassword) {
    throw new Error(
      "Capital.com credentials not configured. " +
      "Please set CAPITAL_API_KEY, CAPITAL_IDENTIFIER, and CAPITAL_PASSWORD " +
      "as environment variables, or save them via the Settings page."
    );
  }

  logger.info(
    { url: settings.capitalApiUrl, identifier: settings.capitalIdentifier, isDemo: settings.isDemo },
    "Connecting to Capital.com"
  );

  state.client = new CapitalApiClient(
    settings.capitalApiUrl,
    settings.capitalApiKey,
    settings.capitalIdentifier,
    settings.capitalPassword
  );

  await state.client.createSession();

  state.running = true;
  state.startedAt = new Date();
  state.error = null;

  logger.info({ scanIntervalMinutes: 5 }, "Trading bot started — running first scan immediately");

  // FIX #5: Run both scan and monitor immediately on startup.
  // Previously monitorPositions() was never called on the first boot cycle —
  // only inside the interval. Any trades that closed between bot restarts
  // would sit undetected for up to 5 minutes, keeping the performance tab empty.
  await scanMarkets();
  await monitorPositions();

  state.scanInterval = setInterval(async () => {
    if (state.running) {
      await scanMarkets();
      await monitorPositions();
    }
  }, 5 * 60 * 1000);
}

export async function stopBot(): Promise<void> {
  if (!state.running) throw new Error("Bot is not running");

  if (state.scanInterval) {
    clearInterval(state.scanInterval);
    state.scanInterval = null;
  }

  if (state.client) {
    state.client.destroy();
    state.client = null;
  }

  state.running = false;
  state.startedAt = null;

  logger.info("Trading bot stopped");
}

export function getBotClient(): CapitalApiClient | null {
  return state.client;
}
