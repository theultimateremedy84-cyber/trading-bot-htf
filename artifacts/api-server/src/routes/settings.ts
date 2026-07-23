import { Router, type IRouter } from "express";
import { UpdateSettingsBody } from "@workspace/api-zod";
import { db } from "@workspace/db";
import { botSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

function serializeSettings(s: typeof botSettingsTable.$inferSelect) {
  return {
    id: s.id,
    riskPerTrade: s.riskPerTrade,
    maxOpenTrades: s.maxOpenTrades,
    dailyLossLimit: s.dailyLossLimit,
    enabledMarkets: s.enabledMarkets.split(",").map((m: string) => m.trim()).filter(Boolean),
    enabledKillZones: s.enabledKillZones.split(",").map((k: string) => k.trim()).filter(Boolean),
    minConfidence: s.minConfidence,
    useOrderBlocks: s.useOrderBlocks,
    useFairValueGaps: s.useFairValueGaps,
    useLiquiditySweeps: s.useLiquiditySweeps,
    useBOS: s.useBOS,
    useChoCH: s.useChoCH,
    trailingStop: s.trailingStop,
    minRR: s.minRR,
    capitalApiKey: s.capitalApiKey ? "***" : "",
    capitalApiUrl: s.capitalApiUrl,
    isDemo: s.isDemo,
  };
}

router.get("/settings", async (req, res) => {
  try {
    let rows = await db.select().from(botSettingsTable).limit(1);
    if (rows.length === 0) {
      const inserted = await db.insert(botSettingsTable).values({}).returning();
      rows = inserted;
    }
    res.json(serializeSettings(rows[0]));
  } catch (err) {
    req.log.error({ err }, "Failed to get settings");
    res.status(500).json({ error: "Failed to get settings" });
  }
});

router.put("/settings", async (req, res) => {
  try {
    const body = UpdateSettingsBody.parse(req.body);

    const updateData: Partial<typeof botSettingsTable.$inferInsert> = {};

    if (body.riskPerTrade !== undefined) updateData.riskPerTrade = body.riskPerTrade;
    if (body.maxOpenTrades !== undefined) updateData.maxOpenTrades = body.maxOpenTrades;
    if (body.dailyLossLimit !== undefined) updateData.dailyLossLimit = body.dailyLossLimit;
    if (body.enabledMarkets !== undefined) updateData.enabledMarkets = body.enabledMarkets.join(",");
    if (body.enabledKillZones !== undefined) updateData.enabledKillZones = body.enabledKillZones.join(",");
    if (body.minConfidence !== undefined) updateData.minConfidence = body.minConfidence;
    if (body.useOrderBlocks !== undefined) updateData.useOrderBlocks = body.useOrderBlocks;
    if (body.useFairValueGaps !== undefined) updateData.useFairValueGaps = body.useFairValueGaps;
    if (body.useLiquiditySweeps !== undefined) updateData.useLiquiditySweeps = body.useLiquiditySweeps;
    if (body.useBOS !== undefined) updateData.useBOS = body.useBOS;
    if (body.useChoCH !== undefined) updateData.useChoCH = body.useChoCH;
    if (body.trailingStop !== undefined) updateData.trailingStop = body.trailingStop;
    if (body.minRR !== undefined) updateData.minRR = body.minRR;
    if (body.capitalApiUrl !== undefined) updateData.capitalApiUrl = body.capitalApiUrl;
    if (body.isDemo !== undefined) updateData.isDemo = body.isDemo;
    // Only update API key if a real value (not masked) is provided
    if (body.capitalApiKey && body.capitalApiKey !== "***") updateData.capitalApiKey = body.capitalApiKey;

    updateData.updatedAt = new Date();

    let rows = await db.select().from(botSettingsTable).limit(1);
    let updated;
    if (rows.length === 0) {
      const inserted = await db.insert(botSettingsTable).values(updateData).returning();
      updated = inserted[0];
    } else {
      const result = await db
        .update(botSettingsTable)
        .set(updateData)
        .where(eq(botSettingsTable.id, rows[0].id))
        .returning();
      updated = result[0];
    }

    res.json(serializeSettings(updated));
  } catch (err) {
    req.log.error({ err }, "Failed to update settings");
    res.status(400).json({ error: "Failed to update settings" });
  }
});

export default router;
