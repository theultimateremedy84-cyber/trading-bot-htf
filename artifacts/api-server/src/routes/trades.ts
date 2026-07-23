import { Router, type IRouter } from "express";
import { GetTradesQueryParams } from "@workspace/api-zod";
import { db } from "@workspace/db";
import { tradesTable } from "@workspace/db";
import { desc, eq, and, isNotNull } from "drizzle-orm";

const router: IRouter = Router();

router.get("/trades", async (req, res) => {
  try {
    const { limit = 50, market } = GetTradesQueryParams.parse(req.query);

    let rows = await db
      .select()
      .from(tradesTable)
      .orderBy(desc(tradesTable.entryDate))
      .limit(limit);

    if (market) {
      rows = rows.filter((r) => r.market === market || r.epic === market);
    }

    const result = rows.map((t) => ({
      id: t.id,
      epic: t.epic,
      market: t.market,
      direction: t.direction as "BUY" | "SELL",
      size: t.size,
      entryPrice: t.entryPrice,
      exitPrice: t.exitPrice ?? null,
      profit: t.profit ?? null,
      entryDate: t.entryDate.toISOString(),
      exitDate: t.exitDate?.toISOString() ?? null,
      stopLoss: t.stopLoss,
      takeProfit: t.takeProfit,
      strategy: t.strategy,
      result: t.result as "WIN" | "LOSS" | "BREAKEVEN" | null,
      riskRewardRatio: t.riskRewardRatio ?? null,
      signalId: t.signalId ?? null,
    }));

    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Failed to get trades");
    res.status(500).json({ error: "Failed to get trades" });
  }
});

export default router;
