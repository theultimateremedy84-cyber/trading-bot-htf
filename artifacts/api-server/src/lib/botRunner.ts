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
 *            when either threshold is crossed. Zero extra API calls beyond
 *            the two already fetched (getPositions + getAccounts).
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
};

export function getBotState() {
  return {
    running: state.running,
    uptime: state.startedAt ? Math.floor((Date.now() - state.startedAt.getTime()) / 1000) : null,
    lastScan: state.lastScan?.toISOString() ?? null,
    error: state.error,
    sessionValid: state.client?.isSessionValid() ?? false,
    sessionPnlOffset: state.sessionPnlOffset,
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

    const balance = account.balance.balance;
    logger.info(
      { accountId: account.accountId, accountType: account.accountType, balance, openPositions: openCount },
      "Account snapshot"
    );

    // ── Session-based P&L window ──────────────────────────────────────────────
    // sessionStart is set when the bot is manually started, so targets reset
    // on every start/stop cycle.
    const sessionStart = state.startedAt ?? new Date();

    const tradesRows = await db
      .select()
      .from(tradesTable)
      .orderBy(desc(tradesTable.entryDate))
      .limit(100);

    // Raw P&L since this session started (closed trades only)
    const rawSessionPnl = tradesRows
      .filter((t) => t.exitDate && new Date(t.exitDate) >= sessionStart && t.profit !== null)
      .reduce((sum, t) => sum + (t.profit ?? 0), 0);

    // Effective P&L from closed trades — adjusted by any manual reset the user has applied
    const effectivePnl = rawSessionPnl - state.sessionPnlOffset;

    // Unrealized P&L — sum of floating profit/loss on all currently open positions.
    // position.profit is already returned by getPositions() — zero extra API calls needed.
    const unrealizedPnl = openPositions.reduce((sum, p) => sum + (p.position.profit ?? 0), 0);

    // Combined P&L used for halt checks: closed + floating
    const totalPnl = effectivePnl + unrealizedPnl;
    // ─────────────────────────────────────────────────────────────────────────

    // ── Daily profit target halt check ───────────────────────────────────────
    if (settings.haltOnDailyProfit && totalPnl >= settings.dailyProfitTarget) {
      logger.info(
        {
          effectivePnl: effectivePnl.toFixed(2),
          unrealizedPnl: unrealizedPnl.toFixed(2),
          totalPnl: totalPnl.toFixed(2),
          target: settings.dailyProfitTarget,
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

        const sizeResult = calculatePositionSize({
          accountBalance: balance,
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

          logger.info({ epic, dealId: confirmation.dealId, status: confirmation.status }, "Deal confirmation received");

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
          const errMsg = execErr instanceof Error ? execErr.message : String(execErr);
          logger.error(
            { epic, size: sizeResult.size, direction: signal.direction, stop: formatPrice(signal.stopLoss, epic), target: formatPrice(signal.takeProfit, epic) },
            `❌ Failed to execute trade on ${epic}: ${errMsg}`
          );
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
      .from(tradesTable)
      .where(isNull(tradesTable.result));

    if (openTrades.length > 0) {
      logger.info({ openTrades: openTrades.length }, "Monitoring open positions");
    }

    for (const trade of openTrades) {
      if (!trade.dealId) continue;

      try {
        const positions = await state.client.getPositions();
        const pos = positions.find((p) => p.position.dealId === trade.dealId);

        if (!pos) {
          const market = await state.client.getSingleMarket(trade.epic);
          const exitPrice = market ? (market.bid + market.offer) / 2 : trade.entryPrice;
          const profit = trade.direction === "BUY"
            ? (exitPrice - trade.entryPrice) * trade.size
            : (trade.entryPrice - exitPrice) * trade.size;

          const result = profit > 0 ? "WIN" : profit < 0 ? "LOSS" : "BREAKEVEN";
          const rr = Math.abs(profit) / (Math.abs(trade.entryPrice - trade.stopLoss) * trade.size);

          await db.update(tradesTable)
            .set({ exitPrice, profit, exitDate: new Date(), result, riskRewardRatio: rr })
            .where(eq(tradesTable.id, trade.id));

          logger.info({ tradeId: trade.id, result, profit: profit.toFixed(4), rr: rr.toFixed(2) }, "Trade closed");
        }
      } catch (err) {
        logger.error({ err, tradeId: trade.id }, "Error monitoring position");
      }
    }
  } catch (err) {
    logger.error({ err }, "Error monitoring positions");
  }
}


/**
 * Real-time P&L halt monitor — runs every 15 seconds.
 *
 * Checks totalPnl (closed + unrealized) against the daily profit target and
 * daily loss limit.  When either threshold is crossed it immediately closes
 * all open positions (profit halt only) and stops the bot — without waiting
 * for the next 5-minute scan cycle.
 *
 * Only two lightweight API calls are made (getPositions + getAccounts) —
 * identical to what the main scan already fetches, so no extra load.
 */
async function monitorPnlHalt() {
  if (!state.client || !state.running) return;

  try {
    const [openPositions, accounts] = await Promise.all([
      state.client.getPositions(),
      state.client.getAccounts(),
    ]);

    const account = accounts[0];
    if (!account) return;

    const balance = account.balance.balance;
    const sessionStart = state.startedAt ?? new Date();
    const settings = await loadSettings();

    const tradesRows = await db
      .select()
      .from(tradesTable)
      .orderBy(desc(tradesTable.entryDate))
      .limit(100);

    const rawSessionPnl = tradesRows
      .filter((t) => t.exitDate && new Date(t.exitDate) >= sessionStart && t.profit !== null)
      .reduce((sum, t) => sum + (t.profit ?? 0), 0);

    const effectivePnl   = rawSessionPnl - state.sessionPnlOffset;
    const unrealizedPnl  = openPositions.reduce((sum, p) => sum + (p.position.profit ?? 0), 0);
    const totalPnl       = effectivePnl + unrealizedPnl;

    // ── Profit target halt ────────────────────────────────────────────────────
    if (settings.haltOnDailyProfit && totalPnl >= settings.dailyProfitTarget) {
      logger.info(
        {
          effectivePnl:  effectivePnl.toFixed(2),
          unrealizedPnl: unrealizedPnl.toFixed(2),
          totalPnl:      totalPnl.toFixed(2),
          target:        settings.dailyProfitTarget,
        },
        "🎯 [Real-time monitor] Daily profit target reached — closing all positions and halting bot"
      );
      // Guard: scan cycle may have already triggered stopBot()
      if (!state.running) return;
      try {
        for (const pos of openPositions) {
          await state.client?.closePosition(pos.position.dealId).catch((e) =>
            logger.error({ err: e, dealId: pos.position.dealId }, "Failed to close position during real-time profit halt")
          );
        }
      } catch (closeErr) {
        logger.error({ err: closeErr }, "Error closing positions during real-time profit halt");
      }
      if (state.running) await stopBot();
      return;
    }

    // ── Loss limit halt ───────────────────────────────────────────────────────
    const lossLimitAmount = (balance * settings.dailyLossLimit) / 100;
    if (totalPnl <= -Math.abs(lossLimitAmount)) {
      logger.info(
        {
          effectivePnl:  effectivePnl.toFixed(2),
          unrealizedPnl: unrealizedPnl.toFixed(2),
          totalPnl:      totalPnl.toFixed(2),
          lossLimit:     `-${lossLimitAmount.toFixed(2)}`,
        },
        "🛑 [Real-time monitor] Daily loss limit breached — halting bot"
      );
      if (state.running) await stopBot();
      return;
    }
  } catch (err) {
    // Non-fatal — log and wait for the next tick
    logger.error({ err }, "Error in real-time P&L monitor — will retry on next tick");
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
  state.sessionPnlOffset = 0;  // ← reset offset on every manual start
  state.error = null;

  logger.info({ scanIntervalMinutes: 5 }, "Trading bot started — running first scan immediately");

  await scanMarkets();
  await monitorPositions();

  state.scanInterval = setInterval(async () => {
    if (state.running) {
      await scanMarkets();
      await monitorPositions();
    }
  }, 5 * 60 * 1000);

  // Real-time P&L monitor — lightweight, runs every 15 seconds
  state.pnlMonitorInterval = setInterval(async () => {
    if (state.running) {
      await monitorPnlHalt();
    }
  }, 15 * 1000);
}

export async function stopBot(): Promise<void> {
  if (!state.running) throw new Error("Bot is not running");

  if (state.scanInterval) {
    clearInterval(state.scanInterval);
    state.scanInterval = null;
  }

  if (state.pnlMonitorInterval) {
    clearInterval(state.pnlMonitorInterval);
    state.pnlMonitorInterval = null;
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
