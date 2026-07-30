import { Router, type IRouter } from "express";
import { getBotState, startBot, stopBot, resetSessionPnl } from "../lib/botRunner";
import { db } from "@workspace/db";
import { tradesTable, botSettingsTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/bot/status", async (req, res) => {
  try {
    const botState = getBotState();

    const openTrades = await db.select().from(tradesTable);
    const openPositions = openTrades.filter((t) => !t.exitDate).length;

    const settings = await db.select().from(botSettingsTable).limit(1);
    const activeMarkets = settings[0]
      ? settings[0].enabledMarkets.split(",").filter(Boolean).length
      : 8;

    res.json({
      running: botState.running,
      uptime: botState.uptime,
      lastScan: botState.lastScan,
      openPositions,
      activeMarkets,
      sessionValid: botState.sessionValid,
      error: botState.error,
      sessionPnlOffset: botState.sessionPnlOffset,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get bot status");
    res.status(500).json({ error: "Failed to get bot status" });
  }
});

router.post("/bot/start", async (req, res) => {
  try {
    await startBot();
    const botState = getBotState();
    res.json({
      running: botState.running,
      uptime: botState.uptime,
      lastScan: botState.lastScan,
      openPositions: 0,
      activeMarkets: 8,
      sessionValid: botState.sessionValid,
      error: botState.error,
      sessionPnlOffset: botState.sessionPnlOffset,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to start bot");
    const msg = err instanceof Error ? err.message : "Failed to start bot";
    res.status(400).json({ error: msg });
  }
});

router.post("/bot/stop", async (req, res) => {
  try {
    await stopBot();
    const botState = getBotState();
    res.json({
      running: botState.running,
      uptime: botState.uptime,
      lastScan: botState.lastScan,
      openPositions: 0,
      activeMarkets: 8,
      sessionValid: botState.sessionValid,
      error: botState.error,
      sessionPnlOffset: botState.sessionPnlOffset,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to stop bot");
    const msg = err instanceof Error ? err.message : "Failed to stop bot";
    res.status(400).json({ error: msg });
  }
});

/**
 * POST /bot/reset-session
 * Body: { startingPnl?: number }  — defaults to 0 (full reset)
 *
 * Resets the effective session P&L counter without stopping the bot.
 * The halt check on the very next scan will measure P&L from the new baseline.
 */
router.post("/bot/reset-session", async (req, res) => {
  try {
    const { startingPnl = 0 } = req.body as { startingPnl?: number };

    if (typeof startingPnl !== "number" || !isFinite(startingPnl)) {
      res.status(400).json({ error: "startingPnl must be a finite number" });
      return;
    }

    await resetSessionPnl(startingPnl);

    res.json({ success: true, startingPnl });
  } catch (err) {
    req.log.error({ err }, "Failed to reset session P&L");
    const msg = err instanceof Error ? err.message : "Failed to reset session P&L";
    res.status(400).json({ error: msg });
  }
});

export default router;
