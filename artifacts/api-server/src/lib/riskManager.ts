/**
 * Risk Management Module
 * - Position sizing based on account balance and risk %
 * - Daily loss limit enforcement
 * - Max open trades enforcement
 *
 * FIX LOG:
 *   [Bug #A] getContractMultiplier: Capital.com CFD API uses ACTUAL UNITS,
 *            not lot conventions. 1 unit of Silver = 1 troy oz, 1 unit of
 *            Gold = 1 troy oz, 1 unit of Forex = 1 base-currency unit.
 *            Old code used CME futures lot sizes (5,000 oz for Silver,
 *            100 oz for Gold, 100,000 units for Forex) which caused
 *            position sizing to collapse to the instrument minimum on
 *            every Silver/Gold trade, effectively risking near-zero.
 *   [Bug #B] getMaxSizeForEpic: caps were calibrated for the wrong lot
 *            convention and prevented proper 1% risk from being taken.
 *            Updated to reflect actual troy-oz and base-currency-unit caps.
 *   [Bug #C] getMinStopDistance (Silver): 0.2% was borderline for
 *            Capital.com's demo API and too tight for ICT-style OB/FVG
 *            entries. Widened to 0.5% to ensure order acceptance and give
 *            Silver trades meaningful room to breathe.
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
}

export interface SizeResult {
  size: number;
  riskAmount: number;
  riskPercent: number;
  stopDistance: number;
}

/**
 * FIX #A — Contract multiplier.
 *
 * Capital.com's CFD `size` parameter is expressed in UNITS of the
 * underlying asset — NOT in exchange lots. Specifically:
 *
 *   Silver : size = troy ounces   (1 unit = 1 oz @ ~$59/oz)
 *   Gold   : size = troy ounces   (1 unit = 1 oz @ ~$3,300/oz)
 *   Forex  : size = base-currency units (1 unit = 1 EUR for EURUSD)
 *   BTC    : size = coins          (1 unit = 1 BTC)
 *   ETH    : size = coins          (1 unit = 1 ETH)
 *
 * Source: Capital.com KID document — "50 Troy Ounces of Gold … for every
 * dollar the price moves, an investor would make or lose USD 50."
 * This confirms size=50 → 50 oz, multiplier=1.
 *
 * OLD (wrong): Silver=5,000, Gold=100, Forex=100,000 (CME lot convention)
 * NEW (correct): all instruments return 1.
 *
 * Profit formula (already correct in monitorPositions):
 *   P&L = (exitPrice − entryPrice) × size
 * With multiplier=1, `size` holds actual units, so this is correct as-is.
 */
function getContractMultiplier(_epic: string): number {
  return 1;
}

/**
 * Calculate position size in units based on risk percentage.
 * `epic` is required so the correct contract multiplier is applied.
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

  const riskAmount = (accountBalance * riskPerTrade) / 100;
  const stopDistance = Math.abs(entryPrice - stopLoss);

  if (stopDistance <= 0) {
    return { size: minSize, riskAmount, riskPercent: riskPerTrade, stopDistance: 0 };
  }

  const multiplier = getContractMultiplier(epic);

  // size (units) = riskAmount / (stopDistance × contractMultiplier)
  // With multiplier=1 this simplifies to: size = riskAmount / stopDistance
  let size = riskAmount / (stopDistance * multiplier);

  // Round down to specified decimal places
  const factor = Math.pow(10, decimalPlaces);
  size = Math.floor(size * factor) / factor;

  // Clamp between min and max
  size = Math.max(minSize, Math.min(maxSize, size));

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

/**
 * Minimum position size per instrument.
 * Capital.com enforces a per-instrument minimum deal size.
 *   BTC/ETH : fractional coins
 *   Gold    : 1 troy oz minimum
 *   Silver  : 1 troy oz minimum
 *   Forex   : 1,000 base-currency units (≈ 0.01 mini lot)
 */
export function getMinSizeForEpic(epic: string): number {
  if (epic.includes("BTC")) return 0.0001;
  if (epic.includes("ETH")) return 0.001;
  if (epic === "GOLD" || epic.includes("XAU")) return 1;    // 1 troy oz
  if (epic === "SILVER" || epic.includes("XAG")) return 1;  // 1 troy oz
  return 1_000; // Forex: 1,000 base-currency units minimum
}

/**
 * Decimal places for rounding position size per instrument.
 */
export function getDecimalPlacesForEpic(epic: string): number {
  if (epic.includes("BTC")) return 4;
  if (epic.includes("ETH")) return 3;
  if (epic === "GOLD" || epic === "SILVER") return 1;  // e.g. 15.3 oz
  return 0; // Forex: whole base-currency units (e.g. 100,000)
}

/**
 * FIX #B — Maximum position size per instrument.
 *
 * OLD caps were calibrated for the wrong lot convention and effectively
 * prevented meaningful risk from being taken on Silver and Gold.
 *
 * NEW caps are in Capital.com's native units (troy oz / base-currency units):
 *   BTC    : 0.05 coins (~$3,200 notional at $64k) — unchanged
 *   ETH    : 1 coin   (~$1,880 notional)           — unchanged
 *   Gold   : 30 oz    (~$99,000 notional at $3,300/oz) allows 1% risk
 *   Silver : 500 oz   (~$29,500 notional at $59/oz)    allows 1% risk
 *   Forex  : 200,000 base-currency units (≈ 2 standard lots)
 */
export function getMaxSizeForEpic(epic: string): number {
  if (epic.includes("BTC"))  return 0.05;
  if (epic.includes("ETH"))  return 1;
  if (epic === "GOLD"   || epic.includes("XAU")) return 30;
  if (epic === "SILVER" || epic.includes("XAG")) return 500;
  return 200_000; // Forex: 200,000 base-currency units = 2 standard lots
}

/**
 * Minimum stop distance for each instrument.
 * Capital.com enforces a per-instrument minimum stop distance.
 * Orders with a stop too close to the current price are rejected.
 *
 * FIX #C — Silver widened from 0.2% to 0.5%.
 * Rationale:
 *   • Capital.com's demo API was occasionally rejecting the 0.2% floor.
 *   • ICT strategy OB/FVG stops can be as tight as 0.05% before enforcement
 *     widens them — 0.5% gives a safe margin above the platform minimum
 *     and provides realistic room for Silver's intraday volatility.
 *   • At Silver ~$59/oz: 0.5% = $0.30/oz minimum stop distance.
 *
 * Other instruments unchanged:
 *   BTC/ETH  : 0.30% (~$190 at $64k BTC)
 *   Gold     : 0.20% (~$6.60 at $3,300/oz gold)
 *   Forex    : 0.05% (~5 pips on EURUSD)
 */
export function getMinStopDistance(epic: string, entryPrice: number): number {
  if (epic.includes("BTC"))  return entryPrice * 0.003;
  if (epic.includes("ETH"))  return entryPrice * 0.003;
  if (epic === "GOLD"   || epic.includes("XAU")) return entryPrice * 0.002;
  if (epic === "SILVER" || epic.includes("XAG")) return entryPrice * 0.005; // FIX #C: 0.2% → 0.5%
  return entryPrice * 0.0005; // forex ~5 pips
}
