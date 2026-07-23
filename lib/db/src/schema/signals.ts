import { pgTable, serial, text, real, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const signalsTable = pgTable("signals", {
  id: serial("id").primaryKey(),
  epic: text("epic").notNull(),
  market: text("market").notNull(),
  direction: text("direction").notNull(), // BUY | SELL
  signalType: text("signal_type").notNull(), // ORDER_BLOCK | FAIR_VALUE_GAP | LIQUIDITY_SWEEP | BOS | CHOCH | COMBINED
  timeframe: text("timeframe").notNull(),
  entryPrice: real("entry_price").notNull(),
  stopLoss: real("stop_loss").notNull(),
  takeProfit: real("take_profit").notNull(),
  confidence: real("confidence").notNull(),
  detectedAt: timestamp("detected_at").notNull().defaultNow(),
  executed: boolean("executed").notNull().default(false),
  killZone: text("kill_zone"), // LONDON | NEW_YORK | ASIAN | null
  notes: text("notes"),
  htfBias: text("htf_bias"), // BULLISH | BEARISH
  structureContext: text("structure_context"),
});

export const insertSignalSchema = createInsertSchema(signalsTable).omit({ id: true });
export type InsertSignal = z.infer<typeof insertSignalSchema>;
export type Signal = typeof signalsTable.$inferSelect;
