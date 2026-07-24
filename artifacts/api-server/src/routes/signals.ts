import { Router, type IRouter } from "express";
import { GetSignalsQueryParams } from "@workspace/api-zod";
import { db } from "@workspace/db";
import { signalsTable } from "@workspace/db";
import { desc } from "drizzle-orm";

const router: IRouter = Router();

router.get("/signals", async (req, res) => {
  try {
    const { limit = 20, market } = GetSignalsQueryParams.parse(req.query);

    let rows = await db
      .select()
      .from(signalsTable)
      .orderBy(desc(signalsTable.detectedAt))
      .limit(limit);

    if (market) {
      rows = rows.filter((r) => r.market === market || r.epic === market);
    }

    const result = rows.map((s) => ({
      id: s.id,
      epic: s.epic,
      market: s.market,
      direction: s.direction as "BUY" | "SELL",
      signalType: s.signalType as "ORDER_BLOCK" | "FAIR_VALUE_GAP" | "LIQUIDITY_SWEEP" | "BOS" | "CHOCH" | "COMBINED",
      timeframe: s.timeframe,
      entryPrice: s.entryPrice,
      stopLoss: s.stopLoss,
      takeProfit: s.takeProfit,
      confidence: s.confidence,
      detectedAt: s.detectedAt.toISOString(),
      executed: s.executed,
      killZone: s.killZone as "LONDON" | "NEW_YORK" | "ASIAN" | null,
      notes: s.notes ?? null,
    }));

    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Failed to get signals");
    res.status(500).json({ error: "Failed to get signals" });
  }
});

export default router;
