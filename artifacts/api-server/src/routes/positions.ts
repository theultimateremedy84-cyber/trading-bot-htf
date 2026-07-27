import { Router, type IRouter } from "express";
import { getBotClient } from "../lib/botRunner";
import { db, tradesTable } from "@workspace/db";
import { inArray, isNull } from "drizzle-orm";

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
    if (positions.length === 0) {
      res.json([]);
      return;
    }

    // ── Fetch DB entry prices as a fallback ──────────────────────────────
    // Capital.com's /positions REST response uses "level" for the opening
    // price, NOT "openLevel" (which was a misnamed TypeScript field).
    // Even so, "level" can be missing on demo accounts.  We resolve the
    // entry price through three layers, most-reliable first:
    //   1. p.position.level   — actual Capital.com JSON field (live accounts)
    //   2. p.position.openLevel — kept for backwards compat (often 0/null)
    //   3. tradesTable.entryPrice — the confirmed fill price we recorded
    //      from Capital.com's /confirms endpoint when the trade was placed

    const dealIds = positions
      .map((p) => p.position.dealId)
      .filter((id): id is string => !!id);

    // Load all open DB trades that match any of the live deal IDs
    const dbTrades =
      dealIds.length > 0
        ? await db
            .select({ dealId: tradesTable.dealId, entryPrice: tradesTable.entryPrice })
            .from(tradesTable)
            .where(inArray(tradesTable.dealId, dealIds))
        : [];

    const dbPriceMap = new Map<string, number>();
    for (const t of dbTrades) {
      if (t.dealId && t.entryPrice) dbPriceMap.set(t.dealId, t.entryPrice);
    }
    // ─────────────────────────────────────────────────────────────────────

    const result = positions.map((p) => {
      // Resolve the open price — three fallback layers (see comment above)
      const openLevel =
        p.position.level ??                           // actual Capital.com field
        p.position.openLevel ??                        // legacy mis-named field
        (p.position.dealId ? dbPriceMap.get(p.position.dealId) : undefined) ?? // DB
        0;

      const bid     = p.market.bid   ?? 0;
      const offer   = p.market.offer ?? 0;
      const size    = p.position.size ?? 0;
      const direction = p.position.direction as "BUY" | "SELL";

      // Calculate real-time P&L from live bid/offer vs the resolved open price.
      // Capital.com often returns null/0 for profit on demo open positions.
      //   BUY  → close by selling at bid  → profit = (bid   - open) × size
      //   SELL → close by buying at offer → profit = (open  - offer) × size
      let profit: number;
      if (p.position.profit != null && p.position.profit !== 0) {
        profit = p.position.profit;
      } else if (openLevel > 0 && bid > 0 && direction === "BUY") {
        profit = (bid - openLevel) * size;
      } else if (openLevel > 0 && offer > 0 && direction === "SELL") {
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
