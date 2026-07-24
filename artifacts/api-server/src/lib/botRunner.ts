/**
 * Bot Runner — Main trading bot loop
 *
 * Orchestrates:
 * 1. Capital.com session management
 * 2. Market scanning on schedule
 * 3. ICT signal detection
 * 4. Trade execution
 * 5. Position monitoring
 */

import { db } from "@workspace/db";
import { signalsTable, tradesTable, botSettingsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { CapitalApiClient } from "./capitalApi";
import { analyzeMarket, getCurrentKillZone } from "./ictStrategy";
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
  XAUUSD: "Gold",
  XAGUSD: "Silver",
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

  // Environment variables override DB values so Railway deployments
  // work without a Settings-page visit on first boot.
  return {
    ...row,
    capitalApiKey:     process.env["CAPITAL_API_KEY"]                                        || row.capitalApiKey,
    capitalIdentifier: process.env["CAPITAL_IDENTIFIER"]                                   || row.capitalIdentifier,
    capitalPassword:   process.env["CAPITAL_PASSWORD"]                                     || row.capitalPassword,
    // Railway uses CAPITAL_API_BASE_URL; fall back to CAPITAL_API_URL for compatibility
    capitalApiUrl:     process.env["CAPITAL_API_BASE_URL"] || process.env["CAPITAL_API_URL"] || row.capitalApiUrl,
  };
}

async function scanMarkets() {
  if (!state.client) return;

  try {
    const settings = await loadSettings();
    const markets = settings.enabledMarkets.split(",").map((m: string) => m.trim()).filter(Boolean);
    const enabledKillZones = settings.enabledKillZones.split(",").map((k: string) => k.trim()).filter(Boolean);

    const openPositions = await state.client.getPositions();
    const openCount = openPositions.length;

    const accounts = await state.client.getAccounts();
    const account = accounts[0];
    if (!account) {
      logger.error("No account found");
      return;
    }

    const balance = account.balance.balance;

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

    for (const epic of markets) {
      try {
        const [
          monthlyCandles,
          weeklyCandles,
          dailyCandles,
          h4Candles,
          h1Candles,
          m15Candles,
          marketData,
        ] = await Promise.all([
          state.client.getCandles(epic, "MONTH", 24),
          state.client.getCandles(epic, "WEEK", 52),
          state.client.getCandles(epic, "DAY", 90),
          state.client.getCandles(epic, "HOUR_4", 50),
          state.client.getCandles(epic, "HOUR", 100),
          state.client.getCandles(epic, "MINUTE_15", 100),
          state.client.getSingleMarket(epic),
        ]);

        if (!marketData) {
          logger.warn({ epic }, "Market data not available");
          continue;
        }

        logger.info(
          {
            epic,
            monthly: monthlyCandles.length,
            weekly: weeklyCandles.length,
            daily: dailyCandles.length,
            h4: h4Candles.length,
          },
          "Candle data fetched — running HTF order flow gate"
        );

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

        if (!signal) continue;

        logger.info({ epic, signal: signal.signalType, direction: signal.direction, confidence: signal.confidence }, "ICT signal detected");

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
          logger.info({ reason: dailyRiskCheck.reason }, "Skipping trade execution");
          continue;
        }

        const sizeResult = calculatePositionSize({
          accountBalance: balance,
          riskPerTrade: settings.riskPerTrade,
          entryPrice: signal.entryPrice,
          stopLoss: signal.stopLoss,
          minSize: getMinSizeForEpic(epic),
          decimalPlaces: getDecimalPlacesForEpic(epic),
        });

        if (sizeResult.size <= 0) {
          logger.warn({ epic }, "Calculated size is 0, skipping");
          continue;
        }

        try {
          logger.info({
            epic,
            direction: signal.direction,
            size: sizeResult.size,
            entry: signal.entryPrice,
            stop: signal.stopLoss,
            target: signal.takeProfit,
          }, "Executing trade");

          const dealResult = await state.client.createPosition({
            epic,
            direction: signal.direction,
            size: sizeResult.size,
            stopLevel: formatPrice(signal.stopLoss, epic),
            profitLevel: formatPrice(signal.takeProfit, epic),
          });

          await new Promise((r) => setTimeout(r, 2000));
          const confirmation = await state.client.getDealConfirmation(dealResult.dealReference);

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

          logger.info({ epic, dealId: confirmation.dealId }, "Trade executed successfully");
        } catch (execErr) {
          logger.error({ err: execErr, epic }, "Failed to execute trade");
        }
      } catch (marketErr) {
        logger.error({ err: marketErr, epic }, "Error scanning market");
      }
    }

    state.lastScan = new Date();
  } catch (err) {
    logger.error({ err }, "Error during market scan");
    state.error = err instanceof Error ? err.message : String(err);
  }
}

async function monitorPositions() {
  if (!state.client) return;

  try {
    const openTrades = await db
      .select()
      .from(tradesTable)
      .where(eq(tradesTable.result, null as never));

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

          logger.info({ tradeId: trade.id, result, profit }, "Trade closed");
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
      "as environment variables on Railway, or save them via the Settings page."
    );
  }

  logger.info({ url: settings.capitalApiUrl, identifier: settings.capitalIdentifier }, "Connecting to Capital.com");

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

  logger.info("Trading bot started");

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
