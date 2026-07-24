import { Router, type IRouter } from "express";
import { ClosePositionParams, ClosePositionResponse } from "@workspace/api-zod";
import { getBotClient } from "../lib/botRunner";

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

const router: IRouter = Router();

router.get("/positions", async (req, res) => {
  try {
    const client = getBotClient();
    if (!client) {
      return res.json([]);
    }

    const positions = await client.getPositions();
    const result = positions.map((p) => ({
      dealId: p.position.dealId,
      epic: p.market.epic,
      market: MARKET_MAP[p.market.epic] ?? p.market.instrumentName ?? p.market.epic,
      direction: p.position.direction as "BUY" | "SELL",
      size: p.position.size,
      openLevel: p.position.openLevel,
      currentBid: p.market.bid,
      currentOffer: p.market.offer,
      profit: p.position.profit ?? 0,
      openDate: p.position.openDate,
      stopLevel: p.position.stopLevel ?? null,
      limitLevel: p.position.limitLevel ?? null,
      currency: p.position.currency,
    }));

    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Failed to get positions");
    res.status(500).json({ error: "Failed to get positions" });
  }
});

router.delete("/positions/:dealId", async (req, res) => {
  try {
    const { dealId } = ClosePositionParams.parse({ dealId: req.params.dealId });
    const client = getBotClient();

    if (!client) {
      return res.status(400).json({ error: "Bot not running — start the bot first" });
    }

    await client.closePosition(dealId);
    const data = ClosePositionResponse.parse({
      success: true,
      dealId,
      profit: 0, // actual P&L comes from Capital.com callback
      message: "Position closed successfully",
    });
    res.json(data);
  } catch (err) {
    req.log.error({ err }, "Failed to close position");
    const msg = err instanceof Error ? err.message : "Failed to close position";
    if (msg.includes("404") || msg.includes("not found")) {
      return res.status(404).json({ error: "Position not found" });
    }
    res.status(500).json({ error: msg });
  }
});

export default router;
