/**
 * Risk Management Module
 * - Position sizing based on account balance and risk %
 * - Daily loss limit enforcement
 * - Max open trades enforcement
 */
export interface RiskParams {
  accountBalance: number;
  riskPerTrade: number; // percentage, e.g. 1.0 = 1%
  entryPrice: number;
  stopLoss: number;
  epic: string;
  minSize?: number;
  maxSize?: number;
  decimalPlaces?: number;
  /** Overrides the hardcoded contract multiplier. Capital.com quotes forex deal
   *  size in UNITS of base currency (min 1000) on some accounts and in LOTS on
   *  others; the caller derives this from dealingRules.minDealSize. */
  contractMultiplier?: number;
}
export interface SizeResult {
  size: number;
  riskAmount: number;
  riskPercent: number;
  stopDistance: number;
}
/**
 * Returns the lot/contract multiplier for each instrument.
 *
 * Capital.com size parameter = number of LOTS.
 * 1 lot = contractMultiplier units of the base asset.
 *   Forex (EURUSD etc.) : 1 lot = 100,000 units → multiplier 100,000
 *   Gold  (GOLD/XAUUSD) : 1 lot = 1 oz          → multiplier 1   ← Capital.com specific
 *   Silver (SILVER/XAG) : 1 lot = 1 oz           → multiplier 1   ← Capital.com specific
 *   BTC / ETH           : 1 lot = 1 coin         → multiplier 1
 *
 * Formula: size_lots = riskAmount / (stopDistance × contractMultiplier)
 *
 * Example EURUSD — $10 k account, 1 % risk, 10-pip stop:
 *   riskAmount    = $100
 *   stopDistance  = 0.0010
 *   multiplier    = 100,000
 *   size_lots     = 100 / (0.0010 × 100,000) = 1.0 lot  ✓
 */
function getContractMultiplier(epic: string): number {
  if (epic.includes("BTC") || epic.includes("ETH")) return 1;
  // Capital.com: GOLD and SILVER are 1 oz per lot (NOT standard 100 or 5,000)
  // Verified against live account Jul 2026: 0.1 lot GOLD at ~$4,079 with 20:1
  // leverage → margin $20.40 = 0.1 × $4,079 / 20  ✓  (multiplier must be 1)
  if (epic === "GOLD" || epic.includes("XAU")) return 1;
  if (epic === "SILVER" || epic.includes("XAG")) return 1;
  // Standard forex pairs (EURUSD, GBPUSD, USDJPY, AUDUSD, …)
  return 100_000;
}
/**
 * Calculate position size in lots based on risk percentage.
 * The `epic` field is required so the correct contract multiplier is applied.
 */
export function calculatePositionSize(params: RiskParams): SizeResult {
  const {
    accountBalance,
    riskPerTrade,
    entryPrice,
    stopLoss,
    epic,
    minSize = 0.01,
    maxSize = 100,
    decimalPlaces = 2,
  } = params;
  const multiplierOverride = params.contractMultiplier;
  const riskAmount = (accountBalance * riskPerTrade) / 100;
  const stopDistance = Math.abs(entryPrice - stopLoss);
  if (stopDistance <= 0) {
    return { size: minSize, riskAmount, riskPercent: riskPerTrade, stopDistance: 0 };
  }
  const multiplier = multiplierOverride && multiplierOverride > 0 ? multiplierOverride : getContractMultiplier(epic);
  // size (lots) = riskAmount / (stopDistance × contractMultiplier)
  let size = riskAmount / (stopDistance * multiplier);
  // Round down to specified decimal places
  const factor = Math.pow(10, decimalPlaces);
  size = Math.floor(size * factor) / factor;
  // Clamp between min and max. The minimum always wins: Capital.com rejects any
  // order below dealingRules.minDealSize, so a too-small cap must not push the
  // size under the exchange minimum.
  const effectiveMax = Math.max(minSize, maxSize);
  size = Math.max(minSize, Math.min(effectiveMax, size));
  return {
    size,
    riskAmount,
    riskPercent: riskPerTrade,
    stopDistance,
  };
}
export interface DailyRiskState {
  tradesToday: number;
  pnlToday: number;
  dailyLossLimit: number; // as percentage
  accountBalance: number;
}
export function isDailyLossLimitBreached(state: DailyRiskState): boolean {
  const limitAmount = (state.accountBalance * state.dailyLossLimit) / 100;
  return state.pnlToday <= -Math.abs(limitAmount);
}
export function canOpenNewTrade(
  openPositionsCount: number,
  maxOpenTrades: number,
  dailyRisk: DailyRiskState
): { allowed: boolean; reason?: string } {
  if (isDailyLossLimitBreached(dailyRisk)) {
    return {
      allowed: false,
      reason: `Daily loss limit of ${dailyRisk.dailyLossLimit}% breached (${dailyRisk.pnlToday.toFixed(2)})`,
    };
  }
  if (openPositionsCount >= maxOpenTrades) {
    return {
      allowed: false,
      reason: `Max open trades (${maxOpenTrades}) reached`,
    };
  }
  return { allowed: true };
}
/**
 * Format a price to the correct decimal places for a given instrument.
 */
export function formatPrice(price: number, epic: string): number {
  if (epic.includes("BTC") || epic.includes("ETH")) return Math.round(price * 100) / 100;
  if (epic.includes("JPY")) return Math.round(price * 100) / 100;
  if (epic === "GOLD" || epic === "SILVER" || epic.includes("XAU") || epic.includes("XAG")) return Math.round(price * 100) / 100;
  return Math.round(price * 10_000) / 10_000; // 4 decimal places for FX
}
export function getMinSizeForEpic(epic: string): number {
  if (epic.includes("BTC")) return 0.0001;
  if (epic.includes("ETH")) return 0.001;
  if (epic === "GOLD" || epic.includes("XAU")) return 0.1;
  if (epic === "SILVER" || epic.includes("XAG")) return 1;
  // FIX (live account): Capital.com live enforces a minimum deal size of 0.1 lots
  // for all standard forex pairs (EURUSD, AUDUSD, GBPUSD, USDJPY, etc.).
  // The previous value of 0.01 is only valid on demo. Using 0.01 on live produces
  // Capital.com API error 400: {"errorCode":"error.invalid.size.minvalue"}.
  return 0.1;
}
export function getDecimalPlacesForEpic(epic: string): number {
  if (epic.includes("BTC")) return 4;
  if (epic.includes("ETH")) return 3;
  if (epic === "GOLD" || epic === "SILVER" || epic.includes("XAU") || epic.includes("XAG")) return 1;
  // FIX (live account): forex minimum step is 0.1 lots on Capital.com live.
  // Rounding to 2 decimal places allowed sizes like 0.08 which are below the
  // live minimum. Round to 1 decimal place so all forex sizes are multiples of 0.1.
  return 1;
}
/**
 * Maximum position size per instrument.
 * Keeps the notional exposure within typical Capital.com demo account limits.
 * Without these caps the formula can produce 100+ contracts on crypto, which
 * exceeds demo account margin and gets rejected immediately.
 */
export function getMaxSizeForEpic(epic: string): number {
  if (epic.includes("BTC"))  return 0.05;   // ~$3 200 notional at $64k
  if (epic.includes("ETH"))  return 1;      // ~$1 880 notional
  if (epic === "GOLD"  || epic.includes("XAU")) return 2;
  if (epic === "SILVER" || epic.includes("XAG")) return 20;
  return 2; // forex — 2 units (mini lots)
}
/**
 * Minimum stop distance for each instrument.
 * Capital.com live accounts enforce stricter minimum stop distances than demo.
 * Values here are calibrated for live — they are safe on demo too (just a
 * slightly wider stop, which is preferable to a rejected order).
 *
 *   BTC  0.50 % → ~$320 at $64k    (live minimum ~0.3 %; using 0.5 % for safety)
 *   ETH  0.50 % → ~$9.4 at $1 880  (live minimum ~0.3 %; using 0.5 % for safety)
 *   Gold 0.30 % → ~$5.7 at $1 900  (live minimum ~0.2 %; using 0.3 % for safety)
 *   FX   0.30 % → ~21 pips AUDUSD  (live minimum is typically 15–20 pips)
 *
 * FIX (live account): original value was 0.10 % (~7 pips) — calibrated against
 * Capital.com DEMO which is more lenient.  Live accounts reject orders where the
 * stop is within ~15–20 pips of the current price with
 * error.position.stop.notSufficientDistanceFromCurrentPrice (or similar).
 * Raising to 0.30 % ensures a safe buffer (≈21 pips on AUDUSD at 0.70) that
 * clears Capital.com live's minimum across all FX pairs and market conditions.
 */
export function getMinStopDistance(epic: string, entryPrice: number): number {
  if (epic.includes("BTC"))  return entryPrice * 0.005;  // 0.5 % — live safe
  if (epic.includes("ETH"))  return entryPrice * 0.005;  // 0.5 % — live safe
  if (epic === "GOLD"  || epic.includes("XAU")) return entryPrice * 0.003;  // 0.3 %
  if (epic === "SILVER" || epic.includes("XAG")) return entryPrice * 0.003;  // 0.3 %
  // FIX: raised from 0.001 (7 pips) to 0.003 (21 pips) for Capital.com live.
  // Demo was lenient with tight stops; live rejects orders that are too close
  // to the current price. 0.3 % keeps us safely above the live minimum.
  return entryPrice * 0.003; // forex ~21 pips on AUDUSD at 0.70 — live minimum
}
