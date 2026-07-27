import { pgTable, serial, text, real, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ─── Signals ──────────────────────────────────────────────────────────────────
// Every ICT signal detected by the bot is stored here whether or not it is
// executed.  Executed signals get a matching row in tradesTable.

export const signalsTable = pgTable("signals", {
  id:               serial("id").primaryKey(),
  epic:             text("epic").notNull(),
  market:           text("market").notNull(),
  direction:        text("direction").notNull(),          // "BUY" | "SELL"
  signalType:       text("signal_type").notNull(),        // "ORDER_BLOCK" | "FAIR_VALUE_GAP" | …
  timeframe:        text("timeframe").notNull(),          // "M15"
  entryPrice:       real("entry_price").notNull(),
  stopLoss:         real("stop_loss").notNull(),
  takeProfit:       real("take_profit").notNull(),
  confidence:       real("confidence").notNull(),
  killZone:         text("kill_zone"),                    // "LONDON" | "NEW_YORK" | "ASIAN" | null
  notes:            text("notes"),
  htfBias:          text("htf_bias"),                    // "BULLISH" | "BEARISH" | "SIDEWAYS"
  structureContext: text("structure_context"),            // e.g. "M:BULLISH W:BULLISH D:BULLISH …"
  executed:         boolean("executed").notNull().default(false),
  detectedAt:       timestamp("detected_at").notNull().defaultNow(),
});

export const insertSignalSchema = createInsertSchema(signalsTable).omit({ id: true, detectedAt: true });
export type InsertSignal = z.infer<typeof insertSignalSchema>;
export type Signal = typeof signalsTable.$inferSelect;

// ─── Trades ───────────────────────────────────────────────────────────────────
// Every position opened on Capital.com (by the bot or recovered as an orphan)
// has a row here.  Open trades have result = null and exitDate = null.

export const tradesTable = pgTable("trades", {
  id:              serial("id").primaryKey(),
  dealId:          text("deal_id"),                      // Capital.com dealId (nullable until confirmed)
  epic:            text("epic").notNull(),
  market:          text("market").notNull(),
  direction:       text("direction").notNull(),           // "BUY" | "SELL"
  size:            real("size").notNull(),
  entryPrice:      real("entry_price").notNull(),
  exitPrice:       real("exit_price"),
  profit:          real("profit"),
  stopLoss:        real("stop_loss").notNull(),
  takeProfit:      real("take_profit").notNull(),
  strategy:        text("strategy").notNull(),            // "ICT-COMBINED" | "MANUAL" | …
  result:          text("result"),                        // "WIN" | "LOSS" | "BREAKEVEN" | null
  riskRewardRatio: real("risk_reward_ratio"),
  signalId:        integer("signal_id"),                  // FK to signalsTable.id (loose ref)
  notes:           text("notes"),
  entryDate:       timestamp("entry_date").notNull().defaultNow(),
  exitDate:        timestamp("exit_date"),
});

export const insertTradeSchema = createInsertSchema(tradesTable).omit({ id: true, entryDate: true });
export type InsertTrade = z.infer<typeof insertTradeSchema>;
export type Trade = typeof tradesTable.$inferSelect;

// ─── Bot Settings ─────────────────────────────────────────────────────────────
// Single-row config table.  The bot reads this at startup and on each scan.
// Defaults match a conservative demo-account configuration.

export const botSettingsTable = pgTable("bot_settings", {
  id:                serial("id").primaryKey(),

  // Capital.com credentials
  capitalApiKey:     text("capital_api_key").notNull().default(""),
  capitalApiUrl:     text("capital_api_url").notNull().default("https://demo-api-capital.backend.capsule.evnfx.com"),
  capitalIdentifier: text("capital_identifier").notNull().default(""),
  capitalPassword:   text("capital_password").notNull().default(""),
  isDemo:            boolean("is_demo").notNull().default(true),

  // Risk management
  riskPerTrade:      real("risk_per_trade").notNull().default(1.0),   // percentage
  maxOpenTrades:     integer("max_open_trades").notNull().default(3),
  dailyLossLimit:    real("daily_loss_limit").notNull().default(3.0), // percentage

  // Strategy filters
  minConfidence:     real("min_confidence").notNull().default(60),
  minRR:             real("min_rr").notNull().default(1.5),
  useOrderBlocks:    boolean("use_order_blocks").notNull().default(true),
  useFairValueGaps:  boolean("use_fair_value_gaps").notNull().default(true),
  useLiquiditySweeps: boolean("use_liquidity_sweeps").notNull().default(true),
  useBOS:            boolean("use_bos").notNull().default(true),
  useChoCH:          boolean("use_choch").notNull().default(true),
  trailingStop:      boolean("trailing_stop").notNull().default(false),

  // Enabled markets — comma-separated epic strings
  enabledMarkets:    text("enabled_markets").notNull().default("BTCUSD,ETHUSD,GOLD,SILVER,EURUSD,GBPUSD,USDJPY"),

  // Enabled kill zones — comma-separated: "LONDON,NEW_YORK,ASIAN"
  enabledKillZones:  text("enabled_kill_zones").notNull().default("LONDON,NEW_YORK"),

  updatedAt:         timestamp("updated_at").notNull().defaultNow(),
});

export const insertBotSettingsSchema = createInsertSchema(botSettingsTable).omit({ id: true });
export type InsertBotSettings = z.infer<typeof insertBotSettingsSchema>;
export type BotSettings = typeof botSettingsTable.$inferSelect;
