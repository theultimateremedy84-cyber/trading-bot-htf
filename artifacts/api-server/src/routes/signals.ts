import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { signalsTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";

const router: IRouter = Router();

// ─── GET /signals — recent signals list ───────────────────────────────────────
router.get("/signals", async (req, res) => {
  try {
    const limit = Number(req.query.limit) || 20;
    const market = req.query.market as string | undefined;

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

// ─── GET /signals/:id — full signal detail with HTF breakdown ────────────────
router.get("/signals/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id) || id <= 0) {
      res.status(400).json({ error: "Invalid signal ID" });
      return;
    }

    const rows = await db
      .select()
      .from(signalsTable)
      .where(eq(signalsTable.id, id))
      .limit(1);

    if (rows.length === 0) {
      res.status(404).json({ error: "Signal not found" });
      return;
    }

    const s = rows[0];

    // Compute R:R ratio from stored levels
    const risk = Math.abs(s.entryPrice - s.stopLoss);
    const reward = Math.abs(s.takeProfit - s.entryPrice);
    const rrRatio = risk > 0 ? reward / risk : 0;

    res.json({
      id: s.id,
      epic: s.epic,
      market: s.market,
      direction: s.direction as "BUY" | "SELL",
      signalType: s.signalType,
      timeframe: s.timeframe,
      entryPrice: s.entryPrice,
      stopLoss: s.stopLoss,
      takeProfit: s.takeProfit,
      confidence: s.confidence,
      detectedAt: s.detectedAt.toISOString(),
      executed: s.executed,
      killZone: s.killZone as "LONDON" | "NEW_YORK" | "ASIAN" | null,
      notes: s.notes ?? null,
      // Extra detail fields stored at signal creation time
      htfBias: (s as unknown as Record<string, unknown>).htfBias as string ?? null,
      structureContext: (s as unknown as Record<string, unknown>).structureContext as string ?? null,
      rrRatio,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get signal detail");
    res.status(500).json({ error: "Failed to get signal detail" });
  }
});

export default router;
