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
 */

import { db } from "@workspace/db";
import { signalsTable, tradesTable, botSettingsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
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
  getDecimalPlacesForEpic,
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

        const sizeResult = calculatePositionSize({
          accountBalance: balance,
          riskPerTrade: settings.riskPerTrade,
          entryPrice: signal.entryPrice,
          stopLoss: signal.stopLoss,
          epic,
          minSize: getMinSizeForEpic(epic),
          decimalPlaces: getDecimalPlacesForEpic(epic),
        });

        logger.info(
          {
            epic,
            size: sizeResult.size,
            riskAmount: sizeResult.riskAmount,
            stopDistance: sizeResult.stopDistance,
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
          logger.error({ err: errMsg, epic, size: sizeResult.size, direction: signal.direction }, "❌ Failed to execute trade — Capital.com rejected the order. Check size, margin, and epic name.");
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

async function monitorPositions() {
  if (!state.client) return;

  try {
    const openTrades = await db
      .select()
      .from(tradesTable)
      .where(eq(tradesTable.result, null as never));

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
            .set({
              exitPrice,
              profit,
              exitDate: new Date(),
              result,
              riskRewardRatio: rr,
            })
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

  await scanMarkets();
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
