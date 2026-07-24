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
 * Calculate position size based on risk percentage
 */
export function calculatePositionSize(params: RiskParams): SizeResult {
  const {
    accountBalance,
    riskPerTrade,
    entryPrice,
    stopLoss,
    minSize = 0.01,
    maxSize = 1000,
    decimalPlaces = 2,
  } = params;

  const riskAmount = (accountBalance * riskPerTrade) / 100;
  const stopDistance = Math.abs(entryPrice - stopLoss);

  if (stopDistance <= 0) {
    return { size: minSize, riskAmount, riskPercent: riskPerTrade, stopDistance: 0 };
  }

  // For CFDs/forex: size = risk amount / stop distance
  let size = riskAmount / stopDistance;

  // Round to specified decimals
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
 * Format a number to a specific number of decimal places for a given instrument
 */
export function formatPrice(price: number, epic: string): number {
  // Crypto: 2 decimals for price, but indices/FX need more
  const cryptoEpics = ["BTCUSD", "ETHUSD"];
  const jpyPairs = ["USDJPY"];
  const silverGold = ["XAUUSD", "XAGUSD"];

  if (cryptoEpics.some((e) => epic.includes(e))) return Math.round(price * 100) / 100;
  if (jpyPairs.some((e) => epic.includes(e))) return Math.round(price * 100) / 100;
  if (silverGold.some((e) => epic.includes(e))) return Math.round(price * 100) / 100;

  return Math.round(price * 10000) / 10000; // 4 decimal places for FX
}

export function getMinSizeForEpic(epic: string): number {
  if (epic.includes("BTC")) return 0.0001;
  if (epic.includes("ETH")) return 0.001;
  return 0.01;
}

export function getDecimalPlacesForEpic(epic: string): number {
  if (epic.includes("BTC")) return 4;
  if (epic.includes("ETH")) return 3;
  return 2;
}
