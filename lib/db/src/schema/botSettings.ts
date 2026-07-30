import { pgTable, serial, text, real, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Bot settings table.
 *
 * IMPORTANT — dailyProfitTarget and dailyLossLimit are PERCENTAGES, not dollar amounts.
 *
 * At the moment the bot is turned on, the current account balance is captured
 * (sessionStartBalance). All halt thresholds are then computed on every check as:
 *
 *   profitTargetAmount = sessionStartBalance × dailyProfitTarget / 100
 *   lossLimitAmount    = sessionStartBalance × dailyLossLimit    / 100
 *
 * Because the percentage is read fresh from this table on every 15-second tick,
 * changes made in the dashboard take effect within 15 seconds even while the
 * bot is running. The base balance, however, stays fixed for the whole session
 * so the bar never drifts as profits accumulate.
 *
 * Examples with $500 session-start balance:
 *   dailyProfitTarget = 8.0  → halt when P&L ≥ $40
 *   dailyLossLimit    = 3.0  → halt when P&L ≤ -$15
 */
export const botSettingsTable = pgTable("bot_settings", {
  id: serial("id").primaryKey(),
  riskPerTrade: real("risk_per_trade").notNull().default(1.0),
  maxOpenTrades: integer("max_open_trades").notNull().default(3),
  // Percentage of session-start balance. e.g. 3.0 = stop trading after losing 3% of opening balance.
  dailyLossLimit: real("daily_loss_limit").notNull().default(3.0),
  // Percentage of session-start balance. e.g. 8.0 = close all & halt after gaining 8% of opening balance.
  dailyProfitTarget: real("daily_profit_target").notNull().default(8.0),
  haltOnDailyProfit: boolean("halt_on_daily_profit").notNull().default(true),
  enabledMarkets: text("enabled_markets").notNull().default("BTCUSD,ETHUSD,EURUSD,GBPUSD,USDJPY,USDCHF,GOLD,SILVER,AUDUSD"),
  enabledKillZones: text("enabled_kill_zones").notNull().default("LONDON,NEW_YORK"),
  minConfidence: real("min_confidence").notNull().default(55.0),
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
  capitalApiUrl: text("capital_api_url").notNull().default("https://demo-api-capital.backend.gb.capital.com"),
  isDemo: boolean("is_demo").notNull().default(true),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertBotSettingsSchema = createInsertSchema(botSettingsTable).omit({ id: true, updatedAt: true });
export type InsertBotSettings = z.infer<typeof insertBotSettingsSchema>;
export type BotSettings = typeof botSettingsTable.$inferSelect;
