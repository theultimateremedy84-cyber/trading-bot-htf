import { Router, type IRouter } from "express";
import { getBotClient } from "../lib/botRunner";

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

const router: IRouter = Router();

router.get("/positions", async (req, res) => {
  try {
    const client = getBotClient();
    if (!client) {
      res.json([]);
      return;
    }

    const positions = await client.getPositions();
    const result = positions.map((p) => {
      const openLevel = p.position.openLevel ?? 0;
      const bid = p.market.bid ?? 0;
      const offer = p.market.offer ?? 0;
      const size = p.position.size ?? 0;
      const direction = p.position.direction as "BUY" | "SELL";

      // Capital.com often returns null for profit on open positions.
      // Calculate it from live bid/offer vs open level so the dashboard
      // always shows a real, up-to-date P&L value:
      //   BUY  → you profit when price rises → use bid (sell price) to close
      //   SELL → you profit when price falls → use offer (buy price) to close
      let profit: number;
      if (p.position.profit != null && p.position.profit !== 0) {
        profit = p.position.profit;
      } else if (direction === "BUY" && bid > 0 && openLevel > 0) {
        profit = (bid - openLevel) * size;
      } else if (direction === "SELL" && offer > 0 && openLevel > 0) {
        profit = (openLevel - offer) * size;
      } else {
        profit = 0;
      }

      return {
        dealId: p.position.dealId,
        epic: p.market.epic,
        market: MARKET_MAP[p.market.epic] ?? p.market.instrumentName ?? p.market.epic,
        direction,
        size,
        openLevel,
        currentBid: bid,
        currentOffer: offer,
        profit,
        openDate: p.position.openDate,
        stopLevel: p.position.stopLevel ?? null,
        limitLevel: p.position.limitLevel ?? null,
        currency: p.position.currency,
      };
    });

    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Failed to get positions");
    res.status(500).json({ error: "Failed to get positions" });
  }
});

router.delete("/positions/:dealId", async (req, res) => {
  try {
    const dealId = req.params.dealId;
    const client = getBotClient();

    if (!client) {
      res.status(400).json({ error: "Bot not running — start the bot first" });
      return;
    }

    await client.closePosition(dealId);
    res.json({
      success: true,
      dealId,
      profit: 0,
      message: "Position closed successfully",
    });
  } catch (err) {
    req.log.error({ err }, "Failed to close position");
    const msg = err instanceof Error ? err.message : "Failed to close position";
    if (msg.includes("404") || msg.includes("not found")) {
      res.status(404).json({ error: "Position not found" });
    } else {
      res.status(500).json({ error: msg });
    }
  }
});

export default router;
