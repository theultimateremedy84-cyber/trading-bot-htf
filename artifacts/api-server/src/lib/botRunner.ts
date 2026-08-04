/**
 * Bot Runner — Main trading bot loop
 *
 * FIX LOG:
 *   [Bug #4] Session refresh: ensureSession() is now called proactively at
 *            the start of every scan cycle, not just lazily inside individual
 *            API calls. Prevents stale-token failures between scans.
 *   [Bug #5] monitorPositions() is now called immediately on startBot() and
 *            after every scan, not only inside the interval timer. Previously
 *            closed trades sat undetected for up to 5 minutes after a restart.
 *   [Change] Daily P&L targets (profit halt + loss limit) now reset on every
 *            manual bot start, not at midnight UTC. sessionStart = state.startedAt.
 *   [Feature] resetSessionPnl(newStartingValue) lets the dashboard manually
 *             reset the P&L accumulator to 0 or any custom figure mid-session.
 *   [Fix #6] Profit halt and loss limit now include unrealized P&L from open
 *            positions (position.profit already returned by getPositions() —
 *            zero extra API calls). totalPnl = effectivePnl + unrealizedPnl.
 *   [Fix #7] Real-time P&L monitor runs every 15 s (separate from the 5-min
 *            scan). Checks totalPnl against profit target and loss limit on
 *            every tick — closes all positions and stops the bot immediately
 *            when either threshold is crossed.
 *   [Fix #8] sessionStartBalance is captured once when the bot is turned on.
 *            All halt thresholds are computed as:
 *              dollarThreshold = sessionStartBalance × currentSetting%
 *            The PERCENTAGE values (dailyProfitTarget, dailyLossLimit) are
 *            still loaded fresh from DB on every check so dashboard changes
 *            take effect immediately — but the BASE BALANCE never drifts.
 *   [Fix #9] Deal confirmation status check: live Capital.com returns HTTP 200
 *            for position creation but may set status "REJECTED" in the deal
 *            confirmation. The bot now checks status before recording a trade,
 *            preventing ghost positions in the DB.
 *   [Fix #10] Stop/target anchored to live market price before order placement.
 *            The ICT strategy derives entry from OB/FVG midpoints that can sit
 *            above or below the current market price. Since createPosition()
 *            opens a MARKET order, stopLevel and profitLevel must be valid
 *            relative to the live bid/offer. Previously, a BUY signal with
 *            stop=0.699 while AUDUSD was at 0.641 caused Capital.com API error
 *            400 error.invalid.stop because the stop was above the current
 *            price. The fix recalculates stop/target from the live mid-price
 *            before every order, preserving the original stop distance and R:R.
 *   [Fix #11] Minimum stop distance raised from 0.1 % to 0.3 % for FX pairs.
 *            Capital.com demo tolerates stops as close as 5–7 pips; live accounts
 *            enforce a stricter minimum (≈15–20 pips). The previous 0.1 % value
 *            produced stops of ~7 pips on AUDUSD at 0.70, which live rejected
 *            with error.position.stop.notSufficientDistanceFromCurrentPrice.
 *            0.3 % gives ≈21 pips — safely above the live minimum.
 *            (See riskManager.ts getMinStopDistance.)
 *   [Fix #12] Pre-flight price validation: immediately before createPosition(),
 *            verify that stop is strictly below bid (BUY) or above offer (SELL)
 *            and that target is strictly above offer (BUY) or below bid (SELL).
 *            If either check fails the trade is skipped with a clear warning log
 *            instead of sending a request Capital.com will reject with 400.
 *   [Fix #13] Structured Capital.com error logging: the API error body is now
 *            logged as a separate JSON field (capitalErrorBody) so Railway never
 *            truncates the errorCode. Previously the full JSON was embedded in
 *            the log message string and got cut off in the Railway UI.
 */

import { db } from "@workspace/db";
import { signalsTable, tradesTable, botSettingsTable } from "@workspace/db";
import { eq, desc, isNull } from "drizzle-orm";
import { CapitalApiClient, type CapitalCandle } from "./capitalApi";
import { analyzeMarket, getCurrentKillZone } from "./ictStrategy";

// ─────────────────────────────────────────────
// Candle aggregation helpers
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

function toWeeklyCandles(daily: CapitalCandle[]): CapitalCandle[] {
  return aggregateCandles(daily, 5);
}

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
  USDCHF: "USD/CHF",
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
  /** Lightweight 15-second interval that checks P&L halt conditions in real time. */
  pnlMonitorInterval: NodeJS.Timeout | null;
  /**
   * P&L offset applied to raw session P&L.
   * effectivePnl = rawSessionPnl - sessionPnlOffset
   *
   * When the user resets to zero:    offset = rawSessionPnl       → effectivePnl = 0
   * When the user resets to $X:      offset = rawSessionPnl - X   → effectivePnl = X
   * Default (bot start):             offset = 0                   → effectivePnl = rawSessionPnl
   */
  sessionPnlOffset: number;
  /**
   * Account balance captured exactly when the bot was turned on.
   * All halt-threshold dollar amounts are computed as:
   *   dollarAmount = sessionStartBalance × currentSetting%
   *
   * This ensures the reference point never drifts during a session even as
   * profits accumulate, while still allowing the dashboard to change the
   * percentage at any time (it is read fresh from DB on every check).
   *
   * Reset to null on stopBot() so the next start always captures a fresh value.
   */
  sessionStartBalance: number | null;
}

const state: BotState = {
  running: false,
  startedAt: null,
  lastScan: null,
  error: null,
  client: null,
  scanInterval: null,
  pnlMonitorInterval: null,
  sessionPnlOffset: 0,
  sessionStartBalance: null,
};

export function getBotState() {
  return {
    running: state.running,
    uptime: state.startedAt ? Math.floor((Date.now() - state.startedAt.getTime()) / 1000) : null,
    lastScan: state.lastScan?.toISOString() ?? null,
    error: state.error,
    sessionValid: state.client?.isSessionValid() ?? false,
    sessionPnlOffset: state.sessionPnlOffset,
    sessionStartBalance: state.sessionStartBalance,
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
  return {
    ...row,
    capitalApiKey:     process.env["CAPITAL_API_KEY"]                                        || row.capitalApiKey,
    capitalIdentifier: process.env["CAPITAL_IDENTIFIER"]                                   || row.capitalIdentifier,
    capitalPassword:   process.env["CAPITAL_PASSWORD"]                                     || row.capitalPassword,
    capitalApiUrl:     process.env["CAPITAL_API_BASE_URL"] || process.env["CAPITAL_API_URL"] || row.capitalApiUrl,
  };
}

/**
 * Manually reset the session P&L accumulator.
 *
 * @param newStartingValue - What the effective P&L should read after reset.
 *   Pass 0 (default) to start from scratch.
 *   Pass any positive or negative number to begin from that figure.
 *
 * Can be called while the bot is running — takes effect on the very next scan.
 * Can also be called when the bot is stopped to pre-set an offset for the next session.
 */
export async function resetSessionPnl(newStartingValue: number = 0): Promise<void> {
  const sessionStart = state.startedAt ?? new Date(0); // if bot is stopped, 0 means all-time
  const tradesRows = await db
    .select()
    .from(tradesTable)
    .orderBy(desc(tradesTable.entryDate))
    .limit(100);

  const rawSessionPnl = tradesRows
    .filter((t) => t.exitDate && new Date(t.exitDate) >= sessionStart && t.profit !== null)
    .reduce((sum, t) => sum + (t.profit ?? 0), 0);

  // offset = rawSessionPnl - newStartingValue
  // so that: effectivePnl = rawSessionPnl - offset = newStartingValue
  state.sessionPnlOffset = rawSessionPnl - newStartingValue;

  logger.info(
    { newStartingValue, rawSessionPnl, sessionPnlOffset: state.sessionPnlOffset },
    "Session P&L manually reset"
  );
}

/**
 * Compute the total session P&L (closed + unrealized) against the session-start
 * balance.  This is a pure helper — no side effects, no API calls.
 *
 * @param rawSessionPnl   - Sum of profit on closed trades since sessionStart
 * @param unrealizedPnl   - Sum of position.profit on all currently open positions
 */
function computeTotalPnl(rawSessionPnl: number, unrealizedPnl: number): number {
  const effectivePnl = rawSessionPnl - state.sessionPnlOffset;
  return effectivePnl + unrealizedPnl;
}

async function scanMarkets() {
  if (!state.client) return;

  try {
    await state.client.ensureSession();
  } catch (refreshErr) {
    logger.error({ err: refreshErr }, "Session refresh failed — will retry next scan");
    return;
  }

  const scanStart = new Date().toISOString();
  logger.info({ scanStart }, "=== Market scan starting ===");

  try {
    // Load settings fresh — percentage values (profit target %, loss limit %)
    // may have been updated from the dashboard since the last scan.
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
      logger.error({ err: apiErr }, "Capital.com API call failed — will re-authenticate on next scan.");
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

    const liveBalance = account.balance.balance;
    logger.info(
      { accountId: account.accountId, accountType: account.accountType, liveBalance, openPositions: openCount },
      "Account snapshot"
    );

    // ── Session-based P&L window ──────────────────────────────────────────────
    const sessionStart = state.startedAt ?? new Date();

    const tradesRows = await db
      .select()
      .from(tradesTable)
      .orderBy(desc(tradesTable.entryDate))
      .limit(100);

    const rawSessionPnl = tradesRows
      .filter((t) => t.exitDate && new Date(t.exitDate) >= sessionStart && t.profit !== null)
      .reduce((sum, t) => sum + (t.profit ?? 0), 0);

    const unrealizedPnl = openPositions.reduce((sum, p) => sum + (p.position.profit ?? 0), 0);
    const totalPnl = computeTotalPnl(rawSessionPnl, unrealizedPnl);
    // ─────────────────────────────────────────────────────────────────────────

    // ── Halt threshold calculation ────────────────────────────────────────────
    // Use session-start balance as the reference so the bar never drifts.
    // Fall back to live balance only if startBot() somehow didn't capture it.
    const refBalance = state.sessionStartBalance ?? liveBalance;

    // Dollar thresholds computed from CURRENT settings % × session-start balance.
    // Changing the % in the dashboard takes effect on the very next scan.
    const profitTargetAmount = (refBalance * settings.dailyProfitTarget) / 100;
    const lossLimitAmount    = (refBalance * settings.dailyLossLimit)    / 100;
    // ─────────────────────────────────────────────────────────────────────────

    logger.info(
      {
        sessionStartBalance: refBalance,
        profitTargetPct: settings.dailyProfitTarget,
        profitTargetAmount: profitTargetAmount.toFixed(2),
        lossLimitPct: settings.dailyLossLimit,
        lossLimitAmount: lossLimitAmount.toFixed(2),
        totalPnl: totalPnl.toFixed(2),
      },
      "Session P&L snapshot"
    );

    // ── Daily profit target halt check ───────────────────────────────────────
    if (settings.haltOnDailyProfit && totalPnl >= profitTargetAmount) {
      logger.info(
        {
          totalPnl: totalPnl.toFixed(2),
          profitTargetAmount: profitTargetAmount.toFixed(2),
          profitTargetPct: settings.dailyProfitTarget,
          sessionStartBalance: refBalance,
        },
        "🎯 Daily profit target reached (closed + unrealized) — closing all positions and halting bot"
      );
      try {
        for (const pos of openPositions) {
          await state.client.closePosition(pos.position.dealId).catch((e) =>
            logger.error({ err: e, dealId: pos.position.dealId }, "Failed to close position during profit halt")
          );
        }
      } catch (closeErr) {
        logger.error({ err: closeErr }, "Error while closing positions during profit halt");
      }
      await stopBot();
      return;
    }
    // ─────────────────────────────────────────────────────────────────────────

    const dailyRiskCheck = canOpenNewTrade(openCount, settings.maxOpenTrades, {
      tradesToday: tradesRows.filter((t) => t.exitDate && new Date(t.exitDate) >= sessionStart).length,
      pnlToday: totalPnl,
      dailyLossLimit: settings.dailyLossLimit,
      accountBalance: refBalance,
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

        const [
          dailyCandles,
          h4Candles,
          h1Candles,
          m15Candles,
          marketData,
        ] = await Promise.all([
          state.client.getCandles(epic, "DAY", 200),
          state.client.getCandles(epic, "HOUR_4", 50),
          state.client.getCandles(epic, "HOUR", 100),
          state.client.getCandles(epic, "MINUTE_15", 100),
          state.client.getSingleMarket(epic),
        ]);

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
          "Candle data fetched — running ICT analysis"
        );

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
            "No signal generated — HTF alignment missing, confidence below threshold, or no entry confluence."
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

        // ── Anchor entry/stop/target to live market price ───────────────────
        // Root cause of "Capital.com API error 400: error.invalid.*" on AUDUSD
        // (and any pair where the ICT signal entry diverges from spot):
        //
        // The ICT strategy derives entry from an Order Block or FVG midpoint
        // that may sit well above or below the current market price.
        // createPosition() opens a MARKET order — the fill price is the current
        // bid/offer, not the theoretical OB/FVG level.  When the signal's
        // stopLevel ends up on the wrong side of the live price (e.g. stop
        // 0.699 > bid 0.641 on a BUY), Capital.com rejects the whole order
        // with HTTP 400 error.invalid.stop.  This block recalculates the
        // stop and target relative to the live mid-price before submission,
        // preserving the original stop distance (ATR-derived risk) and R:R.
        //
        // getMinStopDistance() is used as a floor so the stop is never closer
        // than Capital.com live's minimum distance (~21 pips for FX pairs).
        // ────────────────────────────────────────────────────────────────────
        const liveMid = (marketData.bid + marketData.offer) / 2;
        const origStopDist = Math.abs(signal.entryPrice - signal.stopLoss);

        // Enforce the instrument's minimum stop distance (0.3 % for FX = ~21 pips).
        const minStopForRecalc = getMinStopDistance(epic, liveMid);
        const recalcStopDist = Math.max(origStopDist, minStopForRecalc);

        const prevEntry  = signal.entryPrice;
        const prevStop   = signal.stopLoss;
        const prevTarget = signal.takeProfit;

        if (signal.direction === "BUY") {
          signal.entryPrice = liveMid;
          signal.stopLoss   = liveMid - recalcStopDist;
          signal.takeProfit = liveMid + recalcStopDist * settings.minRR;
        } else {
          signal.entryPrice = liveMid;
          signal.stopLoss   = liveMid + recalcStopDist;
          signal.takeProfit = liveMid - recalcStopDist * settings.minRR;
        }

        logger.info(
          {
            epic,
            direction: signal.direction,
            origEntry:  prevEntry,
            origStop:   prevStop,
            origTarget: prevTarget,
            liveMid,
            recalcStopDist,
            newStop:    signal.stopLoss,
            newTarget:  signal.takeProfit,
          },
          "Entry anchored to live price — stop/target recalculated from live mid"
        );
        // ────────────────────────────────────────────────────────────────────

        const minStop = getMinStopDistance(epic, signal.entryPrice);
        const rawStopDistance = Math.abs(signal.entryPrice - signal.stopLoss);

        if (rawStopDistance < minStop) {
          logger.warn(
            { epic, rawStopDistance: rawStopDistance.toFixed(5), minStop: minStop.toFixed(5) },
            "Stop too tight for Capital.com — widening to instrument minimum"
          );
          if (signal.direction === "BUY") {
            signal.stopLoss   = signal.entryPrice - minStop;
            signal.takeProfit = signal.entryPrice + minStop * settings.minRR;
          } else {
            signal.stopLoss   = signal.entryPrice + minStop;
            signal.takeProfit = signal.entryPrice - minStop * settings.minRR;
          }
        }

        const sizeResult = calculatePositionSize({
          accountBalance: liveBalance,
          riskPerTrade: settings.riskPerTrade,
          entryPrice: signal.entryPrice,
          stopLoss: signal.stopLoss,
          epic,
          minSize: getMinSizeForEpic(epic),
          maxSize: getMaxSizeForEpic(epic),
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
          logger.warn({ epic, sizeResult }, "Calculated size is 0 — skipping.");
          continue;
        }

        // ── Pre-flight price validation ──────────────────────────────────────
        // Belt-and-suspenders: confirm stop and target are on the correct side
        // of the live bid/offer AFTER all adjustments.  If anything slipped
        // through (floating-point rounding, market moved between data fetch and
        // order submission), skip this trade with a clear warning instead of
        // sending a request Capital.com will reject with HTTP 400.
        // ────────────────────────────────────────────────────────────────────
        const fmtStop   = formatPrice(signal.stopLoss,   epic);
        const fmtTarget = formatPrice(signal.takeProfit, epic);

        if (signal.direction === "BUY") {
          if (fmtStop >= marketData.bid) {
            logger.warn(
              { epic, fmtStop, bid: marketData.bid, direction: "BUY" },
              "Pre-flight failed: stop >= bid for BUY — skipping trade to avoid Capital.com 400"
            );
            continue;
          }
          if (fmtTarget <= marketData.offer) {
            logger.warn(
              { epic, fmtTarget, offer: marketData.offer, direction: "BUY" },
              "Pre-flight failed: target <= offer for BUY — skipping trade to avoid Capital.com 400"
            );
            continue;
          }
        } else {
          if (fmtStop <= marketData.offer) {
            logger.warn(
              { epic, fmtStop, offer: marketData.offer, direction: "SELL" },
              "Pre-flight failed: stop <= offer for SELL — skipping trade to avoid Capital.com 400"
            );
            continue;
          }
          if (fmtTarget >= marketData.bid) {
            logger.warn(
              { epic, fmtTarget, bid: marketData.bid, direction: "SELL" },
              "Pre-flight failed: target >= bid for SELL — skipping trade to avoid Capital.com 400"
            );
            continue;
          }
        }
        // ────────────────────────────────────────────────────────────────────

        try {
          logger.info({
            epic,
            direction: signal.direction,
            size: sizeResult.size,
            entry: signal.entryPrice,
            stop: fmtStop,
            target: fmtTarget,
            bid: marketData.bid,
            offer: marketData.offer,
            stopPips: Math.round(Math.abs(signal.entryPrice - signal.stopLoss) * 10_000),
            targetPips: Math.round(Math.abs(signal.takeProfit - signal.entryPrice) * 10_000),
          }, "Placing order on Capital.com…");

          const dealResult = await state.client.createPosition({
            epic,
            direction: signal.direction,
            size: sizeResult.size,
            stopLevel: fmtStop,
            profitLevel: fmtTarget,
          });

          logger.info({ epic, dealReference: dealResult.dealReference }, "Order submitted — waiting for confirmation");

          await new Promise((r) => setTimeout(r, 2000));
          const confirmation = await state.client.getDealConfirmation(dealResult.dealReference);

          logger.info({ epic, dealId: confirmation.dealId, status: confirmation.status }, "Deal confirmation received");

          // FIX #9 (live account): always check the deal status before recording.
          // On live Capital.com the API returns HTTP 200 for the position
          // creation request but then reports status "REJECTED" in the deal
          // confirmation (e.g. STOP_OR_LIMIT_NOT_SATISFIED, INSUFFICIENT_FUNDS,
          // IG_UNIT_SIZE_BELOW_MINIMUM, etc.).  The old code ignored this status,
          // marked the signal as executed, and inserted a trade row for a deal
          // that never actually opened — causing ghost positions in the DB.
          if (confirmation.status !== "ACCEPTED" && confirmation.status !== "OPEN") {
            logger.error(
              { epic, dealReference: dealResult.dealReference, dealId: confirmation.dealId, status: confirmation.status },
              `❌ Deal REJECTED by Capital.com (status: ${confirmation.status}) — trade NOT recorded`
            );
            // Leave the signal as unexecuted so it can be retried next scan.
            continue;
          }

          await db.update(signalsTable)
            .set({ executed: true })
            .where(eq(signalsTable.id, savedSignal.id));

          await db.insert(tradesTable).values({
            dealId: confirmation.dealId,
            epic,
            market: MARKET_MAP[epic] ?? epic,
            direction: signal.direction,
            size: sizeResult.size,
            entryPrice: signal.entryPrice,
            stopLoss: signal.stopLoss,
            takeProfit: signal.takeProfit,
            strategy: `ICT-${signal.signalType}`,
            signalId: savedSignal.id,
            notes: signal.notes,
          });

          logger.info({ epic, dealId: confirmation.dealId, size: sizeResult.size, direction: signal.direction }, "✅ Trade executed successfully");
        } catch (execErr) {
          // ── FIX #13: structured error logging ─────────────────────────────
          // Previously the Capital.com JSON error body was embedded in the
          // message string, which Railway truncates in the UI. Now we parse
          // the body and log it as a separate field so the full errorCode is
          // always visible in Railway structured logs.
          const errMsg = execErr instanceof Error ? execErr.message : String(execErr);
          let capitalErrorBody: unknown = undefined;
          try {
            // Error message format: "Capital.com API error 400: <json>"
            const jsonStart = errMsg.indexOf("{");
            if (jsonStart !== -1) {
              capitalErrorBody = JSON.parse(errMsg.slice(jsonStart));
            }
          } catch {
            // Not JSON — leave capitalErrorBody undefined
          }
          logger.error(
            {
              epic,
              size: sizeResult.size,
              direction: signal.direction,
              stop: fmtStop,
              target: fmtTarget,
              bid: marketData.bid,
              offer: marketData.offer,
              // Full Capital.com error as a structured object — never truncated
              capitalErrorBody,
            },
            `❌ Failed to execute trade on ${epic}: ${errMsg}`
          );
          // ──────────────────────────────────────────────────────────────────
        }
      } catch (marketErr) {
        const errMsg = marketErr instanceof Error ? marketErr.message : String(marketErr);
        logger.error({ epic }, `Error scanning market [${epic}]: ${errMsg}`);
      }

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

async function monitorPositions() {
  if (!state.client) return;

  try {
    const openTrades = await db
      .select()
      .from(tradesTable) my
      .where(isNull(tradesTable.result)); **…**

_This response is too long to display in full._
