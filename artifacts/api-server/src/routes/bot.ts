import { Router, type IRouter } from "express";
import { GetBotStatusResponse, StartBotResponse, StopBotResponse } from "@workspace/api-zod";
import { getBotState, startBot, stopBot } from "../lib/botRunner";
import { db } from "@workspace/db";
import { signalsTable, tradesTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/bot/status", async (req, res) => {
  try {
    const botState = getBotState();

    // Count open positions from DB (trades without exitDate)
    const openTrades = await db.select().from(tradesTable);
    const openPositions = openTrades.filter((t) => !t.exitDate).length;

    // Count active markets from settings
    const settings = await db.query.botSettingsTable?.findFirst?.() ?? null;
    const activeMarkets = settings
      ? (settings as { enabledMarkets: string }).enabledMarkets.split(",").filter(Boolean).length
      : 8;

    const data = GetBotStatusResponse.parse({
      running: botState.running,
      uptime: botState.uptime,
      lastScan: botState.lastScan,
      openPositions,
      activeMarkets,
      sessionValid: botState.sessionValid,
      error: botState.error,
    });

    res.json(data);
  } catch (err) {
    req.log.error({ err }, "Failed to get bot status");
    res.status(500).json({ error: "Failed to get bot status" });
  }
});

router.post("/bot/start", async (req, res) => {
  try {
    await startBot();
    const botState = getBotState();
    const data = StartBotResponse.parse({
      running: botState.running,
      uptime: botState.uptime,
      lastScan: botState.lastScan,
      openPositions: 0,
      activeMarkets: 8,
      sessionValid: botState.sessionValid,
      error: botState.error,
    });
    res.json(data);
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
    const data = StopBotResponse.parse({
      running: botState.running,
      uptime: botState.uptime,
      lastScan: botState.lastScan,
      openPositions: 0,
      activeMarkets: 8,
      sessionValid: botState.sessionValid,
      error: botState.error,
    });
    res.json(data);
  } catch (err) {
    req.log.error({ err }, "Failed to stop bot");
    const msg = err instanceof Error ? err.message : "Failed to stop bot";
    res.status(400).json({ error: msg });
  }
});

export default router;
