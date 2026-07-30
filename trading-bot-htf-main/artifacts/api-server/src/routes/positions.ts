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
      // Capital.com returns the open price as `level` in the positions endpoint.
      // `openLevel` is kept as a fallback for any schema variation.
      const openLevel = p.position.level ?? p.position.openLevel ?? null;

      // `profit` is often null in the Capital.com response — calculate it live
      // when not provided.  Formula: priceDelta × size × scalingFactor.
      // scalingFactor encodes the contract value per point (e.g. 1 for Gold,
      // 10000 for FX pairs on some brokers).  Default to 1 when absent.
      const scalingFactor = p.market.scalingFactor ?? 1;
      let profit = p.position.profit ?? null;
      if (profit == null && openLevel != null) {
        const currentPrice =
          p.position.direction === "BUY" ? p.market.bid : p.market.offer;
        const priceDelta =
          p.position.direction === "BUY"
            ? currentPrice - openLevel
            : openLevel - currentPrice;
        profit = priceDelta * p.position.size * scalingFactor;
      }

      // Notional USD value of the position: how many dollars worth of the
      // underlying asset is held.  openLevel × size × scalingFactor gives the
      // raw exposure in the instrument's quote currency (USD for most pairs).
      const notionalValue =
        openLevel != null
          ? Math.round(openLevel * p.position.size * scalingFactor * 100) / 100
          : null;

      return {
        dealId: p.position.dealId,
        epic: p.market.epic,
        market: MARKET_MAP[p.market.epic] ?? p.market.instrumentName ?? p.market.epic,
        direction: p.position.direction as "BUY" | "SELL",
        size: p.position.size,
        notionalValue,
        openLevel,
        currentBid: p.market.bid,
        currentOffer: p.market.offer,
        profit: profit ?? 0,
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
