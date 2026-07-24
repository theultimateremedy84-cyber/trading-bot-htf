import { pgTable, serial, text, real, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const tradesTable = pgTable("trades", {
  id: serial("id").primaryKey(),
  dealId: text("deal_id"),
  epic: text("epic").notNull(),
  market: text("market").notNull(),
  direction: text("direction").notNull(), // BUY | SELL
  size: real("size").notNull(),
  entryPrice: real("entry_price").notNull(),
  exitPrice: real("exit_price"),
  profit: real("profit"),
  entryDate: timestamp("entry_date").notNull().defaultNow(),
  exitDate: timestamp("exit_date"),
  stopLoss: real("stop_loss").notNull(),
  takeProfit: real("take_profit").notNull(),
  strategy: text("strategy").notNull().default("ICT"),
  result: text("result"), // WIN | LOSS | BREAKEVEN
  riskRewardRatio: real("risk_reward_ratio"),
  signalId: integer("signal_id"),
  notes: text("notes"),
});

export const insertTradeSchema = createInsertSchema(tradesTable).omit({ id: true });
export type InsertTrade = z.infer<typeof insertTradeSchema>;
export type Trade = typeof tradesTable.$inferSelect;
