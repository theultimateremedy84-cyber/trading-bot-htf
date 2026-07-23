import { pgTable, serial, text, real, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const botSettingsTable = pgTable("bot_settings", {
  id: serial("id").primaryKey(),
  riskPerTrade: real("risk_per_trade").notNull().default(1.0),
  maxOpenTrades: integer("max_open_trades").notNull().default(3),
  dailyLossLimit: real("daily_loss_limit").notNull().default(3.0),
  enabledMarkets: text("enabled_markets").notNull().default("BTCUSD,ETHUSD,EURUSD,GBPUSD,USDJPY,XAUUSD,XAGUSD,AUDUSD"),
  enabledKillZones: text("enabled_kill_zones").notNull().default("LONDON,NEW_YORK"),
  minConfidence: real("min_confidence").notNull().default(65.0),
  useOrderBlocks: boolean("use_order_blocks").notNull().default(true),
  useFairValueGaps: boolean("use_fair_value_gaps").notNull().default(true),
  useLiquiditySweeps: boolean("use_liquidity_sweeps").notNull().default(true),
  useBOS: boolean("use_bos").notNull().default(true),
  useChoCH: boolean("use_cho_ch").notNull().default(true),
  trailingStop: boolean("trailing_stop").notNull().default(false),
  minRR: real("min_rr").notNull().default(2.0),
  capitalApiKey: text("capital_api_key").notNull().default(""),
  capitalPassword: text("capital_password").notNull().default(""),
  capitalIdentifier: text("capital_identifier").notNull().default(""),
  // Default to demo URL — safer default. isDemo flag must match this URL.
  capitalApiUrl: text("capital_api_url").notNull().default("https://demo-api-capital.backend-capital.com"),
  isDemo: boolean("is_demo").notNull().default(true),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertBotSettingsSchema = createInsertSchema(botSettingsTable).omit({ id: true, updatedAt: true });
export type InsertBotSettings = z.infer<typeof insertBotSettingsSchema>;
export type BotSettings = typeof botSettingsTable.$inferSelect;
