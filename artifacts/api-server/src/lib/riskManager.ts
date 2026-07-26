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
 *   Gold  (XAUUSD)      : 1 lot = 100 oz        → multiplier 100
 *   Silver (XAGUSD)     : 1 lot = 5,000 oz       → multiplier 5,000
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
  // Capital.com uses "GOLD" and "SILVER" as epic names
  if (epic === "GOLD" || epic.includes("XAU")) return 100;
  if (epic === "SILVER" || epic.includes("XAG")) return 5_000;
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

  const riskAmount = (accountBalance * riskPerTrade) / 100;
  const stopDistance = Math.abs(entryPrice - stopLoss);

  if (stopDistance <= 0) {
    return { size: minSize, riskAmount, riskPercent: riskPerTrade, stopDistance: 0 };
  }

  const multiplier = getContractMultiplier(epic);

  // size (lots) = riskAmount / (stopDistance × contractMultiplier)
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

export function getMinSizeForEpic(epic: string): number {
  if (epic.includes("BTC")) return 0.0001;
  if (epic.includes("ETH")) return 0.001;
  if (epic === "GOLD") return 0.1;
  if (epic === "SILVER") return 1;
  return 0.01;
}

export function getDecimalPlacesForEpic(epic: string): number {
  if (epic.includes("BTC")) return 4;
  if (epic.includes("ETH")) return 3;
  if (epic === "GOLD" || epic === "SILVER") return 1;
  return 2;
}
