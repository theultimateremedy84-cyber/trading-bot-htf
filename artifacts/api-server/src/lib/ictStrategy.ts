/**
 * ICT (Inner Circle Trader) Strategy Engine
 *
 * Multi-Timeframe Order Flow + Smart Money Concepts:
 *
 * MANDATORY HIGHER TIMEFRAME GATE (executed first):
 *   1. Monthly  — macro order flow bias
 *   2. Weekly   — intermediate order flow bias
 *   3. Daily    — near-term order flow bias
 *   A majority (2/3 or 3/3) must agree on direction before entry logic runs.
 *   A genuine split (1 vs 1) blocks trading; a majority always wins even if
 *   the minority TF is OPPOSITE — this is normal during pullbacks.
 *
 * ENTRY TIMEFRAME ANALYSIS (H4 → H1 → M15):
 *   - Market Structure (BOS / ChoCH)
 *   - Order Blocks
 *   - Fair Value Gaps (FVG)
 *   - Liquidity Sweeps
 *   - Kill Zones (London / New York)
 *
 * FIX LOG:
 *   [Bug #1] calculateEntryParams: falls back to swing-based stop when no
 *            Order Block or FVG is present (valid ICT concept — swing low/high
 *            as stop anchor). The "last resort" 0.5% fixed stop has been
 *            REMOVED — it produced non-ICT entries at arbitrary market prices
 *            with no structural backing. Return null when no swing is found.
 *   [Bug #2] analyzeHTFOrderFlow: 2/3 HTF majority now allowed, BUT if Daily
 *            is the dissenting TF and actively opposes the direction (BEARISH
 *            on a BUY signal, BULLISH on a SELL signal), the trade is BLOCKED.
 *            Only Monthly or Weekly being the minority is permitted — those
 *            represent longer-term corrections within a daily-confirmed trend.
 *   [Bug #3] analyzeMarket: H4 counter-trend is a soft confidence penalty
 *            (−15 pts) rather than a hard veto. Still blocked if H4 and H1
 *            both conflict simultaneously (−15 each = −30 total makes passing
 *            minConfidence very unlikely without strong confluence).
 *   [Bug #4] calculateConfidence: h4ConflictsHTF and dailyConflictsHTF each
 *            apply a −15 pt penalty. Daily conflict also triggers an additional
 *            −10 pt structural penalty (total −25 when daily opposes).
 */

import type { CapitalCandle } from "./capitalApi";

export type Direction = "BUY" | "SELL";
export type KillZone = "LONDON" | "NEW_YORK" | "ASIAN" | null;
export type SignalType =
  | "ORDER_BLOCK"
  | "FAIR_VALUE_GAP"
  | "LIQUIDITY_SWEEP"
  | "BOS"
  | "CHOCH"
  | "COMBINED";
export type Trend = "BULLISH" | "BEARISH" | "SIDEWAYS";

export interface OHLC {
  time: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface SwingPoint {
  index: number;
  price: number;
  time: Date;
  type: "HIGH" | "LOW";
}

export interface OrderBlock {
  direction: Direction;
  top: number;
  bottom: number;
  time: Date;
  index: number;
  mitigated: boolean;
  strength: number;
}

export interface FairValueGap {
  direction: Direction;
  top: number;
  bottom: number;
  timeStart: Date;
  timeEnd: Date;
  filled: boolean;
  midpoint: number;
}

export interface LiquiditySweep {
  direction: Direction;
  level: number;
  time: Date;
  strength: number;
}

export interface MarketStructure {
  trend: Trend;
  lastBOS: { price: number; time: Date; direction: Direction } | null;
  lastChoCH: { price: number; time: Date; direction: Direction } | null;
  swingHighs: SwingPoint[];
  swingLows: SwingPoint[];
  currentHighs: number[];
  currentLows: number[];
}

export interface OrderFlowLevel {
  timeframe: string;
  bias: Trend;
  strength: number;
  prevCandleHigh: number;
  prevCandleLow: number;
  keyOrderBlock: OrderBlock | null;
  structure: MarketStructure;
  summary: string;
}

export interface HTFOrderFlow {
  monthly: OrderFlowLevel;
  weekly: OrderFlowLevel;
  daily: OrderFlowLevel;
  agreedDirection: Direction | null;
  alignmentCount: number;
  reason: string;
}

export interface ICTSignal {
  direction: Direction;
  signalType: SignalType;
  timeframe: string;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  confidence: number;
  killZone: KillZone;
  notes: string;
  htfBias: Trend;
  structureContext: string;
}

// ─────────────────────────────────────────────
// Candle helpers
// ─────────────────────────────────────────────

function candlesToOHLC(candles: CapitalCandle[]): OHLC[] {
  return candles.map((c) => ({
    time: new Date(c.snapshotTime),
    open: (c.openPrice.bid + c.openPrice.ask) / 2,
    high: (c.highPrice.bid + c.highPrice.ask) / 2,
    low: (c.lowPrice.bid + c.lowPrice.ask) / 2,
    close: (c.closePrice.bid + c.closePrice.ask) / 2,
    volume: c.lastTradedVolume,
  }));
}

// ─────────────────────────────────────────────
// Market Structure
// ─────────────────────────────────────────────

export function detectSwingPoints(candles: OHLC[], lookback = 3): SwingPoint[] {
  const swings: SwingPoint[] = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    const c = candles[i];
    const before = candles.slice(i - lookback, i);
    const after = candles.slice(i + 1, i + lookback + 1);

    if (before.every((x) => x.high <= c.high) && after.every((x) => x.high <= c.high)) {
      swings.push({ index: i, price: c.high, time: c.time, type: "HIGH" });
    }
    if (before.every((x) => x.low >= c.low) && after.every((x) => x.low >= c.low)) {
      swings.push({ index: i, price: c.low, time: c.time, type: "LOW" });
    }
  }
  return swings;
}

export function analyzeMarketStructure(candles: OHLC[]): MarketStructure {
  const swings = detectSwingPoints(candles);
  const swingHighs = swings.filter((s) => s.type === "HIGH");
  const swingLows = swings.filter((s) => s.type === "LOW");

  let lastBOS: MarketStructure["lastBOS"] = null;
  let lastChoCH: MarketStructure["lastChoCH"] = null;
  let trend: Trend = "SIDEWAYS";

  if (swingHighs.length >= 2 && swingLows.length >= 2) {
    const prevHigh = swingHighs[swingHighs.length - 2];
    const lastHigh = swingHighs[swingHighs.length - 1];
    const prevLow = swingLows[swingLows.length - 2];
    const lastLow = swingLows[swingLows.length - 1];
    const lastCandle = candles[candles.length - 1];

    if (lastCandle.close > prevHigh.price && lastHigh.price > prevHigh.price) {
      trend = "BULLISH";
      lastBOS = { price: prevHigh.price, time: lastHigh.time, direction: "BUY" };
    } else if (lastCandle.close < prevLow.price && lastLow.price < prevLow.price) {
      trend = "BEARISH";
      lastBOS = { price: prevLow.price, time: lastLow.time, direction: "SELL" };
    }

    if (trend === "BULLISH" && lastCandle.close < prevLow.price) {
      lastChoCH = { price: prevLow.price, time: lastCandle.time, direction: "SELL" };
    } else if (trend === "BEARISH" && lastCandle.close > prevHigh.price) {
      lastChoCH = { price: prevHigh.price, time: lastCandle.time, direction: "BUY" };
    }
  }

  return {
    trend,
    lastBOS,
    lastChoCH,
    swingHighs,
    swingLows,
    currentHighs: swingHighs.slice(-5).map((s) => s.price),
    currentLows: swingLows.slice(-5).map((s) => s.price),
  };
}

// ─────────────────────────────────────────────
// HTF Order Flow Analysis
// ─────────────────────────────────────────────

function analyzeOrderFlow(candles: OHLC[], timeframe: string): OrderFlowLevel {
  const structure = analyzeMarketStructure(candles);

  let bullishScore = 0;
  let bearishScore = 0;

  if (structure.trend === "BULLISH") bullishScore += 40;
  if (structure.trend === "BEARISH") bearishScore += 40;

  if (structure.lastBOS?.direction === "BUY") bullishScore += 25;
  if (structure.lastBOS?.direction === "SELL") bearishScore += 25;

  const recent = candles.slice(-5);
  for (const c of recent) {
    if (c.close > c.open) bullishScore += 3;
    else if (c.close < c.open) bearishScore += 3;
  }

  if (candles.length >= 10) {
    const tenBack = candles[candles.length - 10];
    const last = candles[candles.length - 1];
    if (last.close > tenBack.open) bullishScore += 10;
    else if (last.close < tenBack.open) bearishScore += 10;
  }

  const highs = structure.swingHighs.slice(-3).map((s) => s.price);
  const lows = structure.swingLows.slice(-3).map((s) => s.price);

  const hhhl =
    highs.length >= 2 &&
    lows.length >= 2 &&
    highs[highs.length - 1] > highs[highs.length - 2] &&
    lows[lows.length - 1] > lows[lows.length - 2];
  const lhll =
    highs.length >= 2 &&
    lows.length >= 2 &&
    highs[highs.length - 1] < highs[highs.length - 2] &&
    lows[lows.length - 1] < lows[lows.length - 2];

  if (hhhl) bullishScore += 10;
  if (lhll) bearishScore += 10;

  const total = bullishScore + bearishScore;
  const bias: Trend =
    total === 0
      ? "SIDEWAYS"
      : bullishScore > bearishScore
      ? "BULLISH"
      : bearishScore > bullishScore
      ? "BEARISH"
      : "SIDEWAYS";

  const strength = total === 0 ? 50 : Math.round((Math.max(bullishScore, bearishScore) / total) * 100);

  const obs = detectOrderBlocks(candles.slice(-30), structure);
  const keyOB = obs.sort((a, b) => b.strength - a.strength)[0] ?? null;

  const prevCandle = candles[candles.length - 2] ?? candles[candles.length - 1];

  const summary = [
    `${timeframe}: ${bias} (${strength}% conviction)`,
    structure.lastBOS ? `BOS @ ${structure.lastBOS.price.toFixed(5)} ${structure.lastBOS.direction}` : null,
    structure.lastChoCH ? `ChoCH @ ${structure.lastChoCH.price.toFixed(5)} ${structure.lastChoCH.direction}` : null,
    hhhl ? "HH/HL pattern" : lhll ? "LH/LL pattern" : null,
    keyOB ? `Key OB: ${keyOB.bottom.toFixed(5)}–${keyOB.top.toFixed(5)}` : null,
  ]
    .filter(Boolean)
    .join(" | ");

  return {
    timeframe,
    bias,
    strength,
    prevCandleHigh: prevCandle.high,
    prevCandleLow: prevCandle.low,
    keyOrderBlock: keyOB,
    structure,
    summary,
  };
}

/**
 * FIX #2 (revised): HTF alignment gate — 2/3 majority allowed, but Daily
 * must NOT actively oppose the trade direction.
 *
 * Rule: if bullishCount >= 2 → BUY, bearishCount >= 2 → SELL.
 * Exception: if 2/3 agree but Daily is the dissenting TF and is actively
 * OPPOSITE (not SIDEWAYS), trade is BLOCKED. Daily sets the near-term
 * structural bias for entry-TF work; trading against it produces the vast
 * majority of stop-outs on HTF-pullback setups.
 *
 * Only Monthly or Weekly being the minority dissenter is tolerated — those
 * represent macro corrections within a daily-confirmed trend.
 */
export function analyzeHTFOrderFlow(
  monthlyCandles: CapitalCandle[],
  weeklyCandles: CapitalCandle[],
  dailyCandles: CapitalCandle[]
): HTFOrderFlow {
  const monthly = analyzeOrderFlow(candlesToOHLC(monthlyCandles), "Monthly");
  const weekly = analyzeOrderFlow(candlesToOHLC(weeklyCandles), "Weekly");
  const daily = analyzeOrderFlow(candlesToOHLC(dailyCandles), "Daily");

  const levels = [monthly, weekly, daily];

  const bullishCount = levels.filter((l) => l.bias === "BULLISH").length;
  const bearishCount = levels.filter((l) => l.bias === "BEARISH").length;

  let agreedDirection: Direction | null = null;
  let alignmentCount = 0;
  let reason = "";

  if (bullishCount >= 2) {
    // Guard: if Daily is actively BEARISH and only 2/3 agree, block the trade.
    // Trading a BUY when Daily is BEARISH means entering against the nearest
    // structural bias — the primary source of premature stop-outs.
    if (bullishCount === 2 && daily.bias === "BEARISH") {
      agreedDirection = null;
      alignmentCount = 0;
      reason = `HTF BLOCKED — M:${monthly.bias} W:${weekly.bias} D:BEARISH. Daily actively opposes BUY direction. Require 3/3 alignment or Daily neutral before entry.`;
    } else {
      agreedDirection = "BUY";
      alignmentCount = bullishCount;
      const minority = bearishCount > 0 ? ` (1 opposing — normal pullback, confidence reduced)` : "";
      reason =
        bullishCount === 3
          ? `ALL 3 HTFs BULLISH — M:BULLISH W:BULLISH D:BULLISH. Full BUY alignment.`
          : bearishCount > 0
          ? `2/3 HTFs BULLISH${minority}. BUY allowed — ${levels.find((l) => l.bias === "BEARISH")?.timeframe} (non-Daily) is BEARISH.`
          : `2/3 HTFs BULLISH (${levels.find((l) => l.bias !== "BULLISH")?.timeframe} is SIDEWAYS). BUY allowed.`;
    }
  } else if (bearishCount >= 2) {
    // Guard: if Daily is actively BULLISH and only 2/3 agree, block the trade.
    if (bearishCount === 2 && daily.bias === "BULLISH") {
      agreedDirection = null;
      alignmentCount = 0;
      reason = `HTF BLOCKED — M:${monthly.bias} W:${weekly.bias} D:BULLISH. Daily actively opposes SELL direction. Require 3/3 alignment or Daily neutral before entry.`;
    } else {
      agreedDirection = "SELL";
      alignmentCount = bearishCount;
      const minority = bullishCount > 0 ? ` (1 opposing — normal bounce, confidence reduced)` : "";
      reason =
        bearishCount === 3
          ? `ALL 3 HTFs BEARISH — M:BEARISH W:BEARISH D:BEARISH. Full SELL alignment.`
          : bullishCount > 0
          ? `2/3 HTFs BEARISH${minority}. SELL allowed — ${levels.find((l) => l.bias === "BULLISH")?.timeframe} (non-Daily) is BULLISH.`
          : `2/3 HTFs BEARISH (${levels.find((l) => l.bias !== "BEARISH")?.timeframe} is SIDEWAYS). SELL allowed.`;
    }
  } else {
    // Genuine split (1 vs 1) or all SIDEWAYS — no trade
    agreedDirection = null;
    alignmentCount = 0;
    reason = `No HTF majority — M:${monthly.bias} W:${weekly.bias} D:${daily.bias}. Market genuinely split or ranging. No trade.`;
  }

  return { monthly, weekly, daily, agreedDirection, alignmentCount, reason };
}

// ─────────────────────────────────────────────
// Entry-TF Analysis
// ─────────────────────────────────────────────

export function detectOrderBlocks(candles: OHLC[], structure: MarketStructure): OrderBlock[] {
  const blocks: OrderBlock[] = [];
  const lastN = candles.slice(-50);

  for (let i = 1; i < lastN.length - 3; i++) {
    const c = lastN[i];
    const next = lastN[i + 1];
    const afterNext = lastN[i + 2];

    if (
      c.close < c.open &&
      next.close > next.open &&
      afterNext.close > afterNext.open &&
      afterNext.close > c.high
    ) {
      const mitigated = lastN.slice(i + 3).some((x) => x.low <= c.close);
      const strength = Math.min(100, ((afterNext.close - c.high) / c.high) * 10_000);
      blocks.push({ direction: "BUY", top: c.open, bottom: c.close, time: c.time, index: i, mitigated, strength });
    }

    if (
      c.close > c.open &&
      next.close < next.open &&
      afterNext.close < afterNext.open &&
      afterNext.close < c.low
    ) {
      const mitigated = lastN.slice(i + 3).some((x) => x.high >= c.close);
      const strength = Math.min(100, ((c.low - afterNext.close) / c.low) * 10_000);
      blocks.push({ direction: "SELL", top: c.close, bottom: c.open, time: c.time, index: i, mitigated, strength });
    }
  }

  return blocks.filter((b) => !b.mitigated);
}

export function detectFairValueGaps(candles: OHLC[]): FairValueGap[] {
  const gaps: FairValueGap[] = [];
  const lastN = candles.slice(-80);

  for (let i = 1; i < lastN.length - 1; i++) {
    const prev = lastN[i - 1];
    const curr = lastN[i];
    const next = lastN[i + 1];

    if (prev.high < next.low && curr.close > curr.open) {
      const filled = lastN.slice(i + 2).some((x) => x.low <= prev.high);
      gaps.push({
        direction: "BUY",
        top: next.low,
        bottom: prev.high,
        timeStart: prev.time,
        timeEnd: next.time,
        filled,
        midpoint: (next.low + prev.high) / 2,
      });
    }

    if (prev.low > next.high && curr.close < curr.open) {
      const filled = lastN.slice(i + 2).some((x) => x.high >= prev.low);
      gaps.push({
        direction: "SELL",
        top: prev.low,
        bottom: next.high,
        timeStart: prev.time,
        timeEnd: next.time,
        filled,
        midpoint: (prev.low + next.high) / 2,
      });
    }
  }

  return gaps.filter((g) => !g.filled);
}

export function detectLiquiditySweeps(candles: OHLC[], structure: MarketStructure): LiquiditySweep[] {
  const sweeps: LiquiditySweep[] = [];
  const lastN = candles.slice(-30);
  const lastCandle = lastN[lastN.length - 1];

  for (const high of structure.currentHighs) {
    const swept = lastN.slice(-5).some((c) => c.high > high);
    const reversed = lastCandle.close < high;
    if (swept && reversed) {
      sweeps.push({
        direction: "SELL",
        level: high,
        time: lastCandle.time,
        strength: Math.min(100, ((lastCandle.high - high) / high) * 10_000 + 50),
      });
    }
  }

  for (const low of structure.currentLows) {
    const swept = lastN.slice(-5).some((c) => c.low < low);
    const reversed = lastCandle.close > low;
    if (swept && reversed) {
      sweeps.push({
        direction: "BUY",
        level: low,
        time: lastCandle.time,
        strength: Math.min(100, ((low - lastCandle.low) / low) * 10_000 + 50),
      });
    }
  }

  return sweeps;
}

export function getCurrentKillZone(): KillZone {
  const now = new Date();
  const h = now.getUTCHours() + now.getUTCMinutes() / 60;
  if (h >= 2 && h < 5) return "LONDON";
  if (h >= 12 && h < 15) return "NEW_YORK";
  if (h >= 23 || h < 1) return "ASIAN";
  return null;
}

/**
 * FIX #1 (revised): calculateEntryParams
 *
 * Priority for entry and stop placement:
 *   1. Order Block midpoint / bottom (or top for SELL) — strongest anchor
 *   2. FVG midpoint / edge — second-best structural anchor
 *   3. Market price entry with stop at recent swing low/high — valid ICT
 *      concept (liquidity sweep reversal, BOS entry from market price)
 *   4. No structural reference available → return null. The previous
 *      "last resort" 0.5% fixed stop has been REMOVED because it produced
 *      blind market-order entries with no ICT structure whatsoever.
 *
 * A swing-based fallback is kept (case 3) because entering at market price
 * with a stop below a confirmed swing low IS a legitimate ICT technique
 * (e.g. after a BOS when price returns to equilibrium). An arbitrary 0.5%
 * stop with no structural reference is not.
 */
export function calculateEntryParams(
  direction: Direction,
  orderBlock: OrderBlock | null,
  fvg: FairValueGap | null,
  currentPrice: number,
  minRR: number,
  recentSwingHigh?: number,
  recentSwingLow?: number,
): { entry: number; stop: number; target: number; rr: number } | null {
  let entry = currentPrice;
  let stop: number;
  let target: number;

  if (direction === "BUY") {
    if (orderBlock) {
      entry = (orderBlock.top + orderBlock.bottom) / 2;
      stop = orderBlock.bottom * 0.9995;
    } else if (fvg) {
      entry = fvg.midpoint;
      stop = fvg.bottom * 0.9995;
    } else if (recentSwingLow !== undefined) {
      // Valid ICT fallback: market-price entry anchored to confirmed swing low.
      // The swing low is a structural level (liquidity pool); placing the stop
      // just below it is an accepted ICT practice for BOS/ChoCH entries.
      entry = currentPrice;
      stop = recentSwingLow * 0.9995;
    } else {
      // No Order Block, FVG, or swing low found — no structural basis for
      // entry. Return null rather than using an arbitrary fixed stop.
      return null;
    }
    target = entry + Math.abs(entry - stop) * minRR;
  } else {
    if (orderBlock) {
      entry = (orderBlock.top + orderBlock.bottom) / 2;
      stop = orderBlock.top * 1.0005;
    } else if (fvg) {
      entry = fvg.midpoint;
      stop = fvg.top * 1.0005;
    } else if (recentSwingHigh !== undefined) {
      // Valid ICT fallback: market-price entry anchored to confirmed swing high.
      entry = currentPrice;
      stop = recentSwingHigh * 1.0005;
    } else {
      // No structural reference available — do not enter.
      return null;
    }
    target = entry - Math.abs(stop - entry) * minRR;
  }

  const risk = Math.abs(entry - stop);
  const reward = Math.abs(target - entry);
  return { entry, stop, target, rr: risk > 0 ? reward / risk : 0 };
}

// ─────────────────────────────────────────────
// Confidence Scoring
// ─────────────────────────────────────────────

export function calculateConfidence(params: {
  htfAlignmentCount: number;
  htfAllThreeAligned: boolean;
  signalDirection: Direction;
  hasOrderBlock: boolean;
  hasFVG: boolean;
  hasLiquiditySweep: boolean;
  hasBOS: boolean;
  hasChoCH: boolean;
  inKillZone: boolean;
  dailyAligned: boolean;
  /** H4 trend opposes HTF direction — soft penalty (−15 pts) */
  h4ConflictsHTF?: boolean;
  /** H1 trend opposes HTF direction — additional soft penalty (−15 pts) */
  h1ConflictsHTF?: boolean;
}): number {
  let score = 0;

  if (params.htfAllThreeAligned) {
    score += 45;
  } else if (params.htfAlignmentCount >= 2) {
    score += 30;
  }

  if (params.dailyAligned) score += 5;
  if (params.inKillZone) score += 15;
  if (params.hasLiquiditySweep) score += 12;
  if (params.hasOrderBlock) score += 10;
  if (params.hasBOS) score += 8;
  if (params.hasFVG) score += 7;
  if (params.hasChoCH) score += 5;
  if (params.hasOrderBlock && params.hasFVG) score += 3;

  // H4 conflict: valid pullback scenario — penalise but do not veto.
  if (params.h4ConflictsHTF) score -= 15;

  // H1 conflict: if H1 also runs counter to HTF direction alongside H4,
  // apply an additional penalty. Two entry-TF timeframes opposing the HTF
  // bias simultaneously is a much weaker setup.
  if (params.h1ConflictsHTF) score -= 15;

  return Math.min(100, Math.max(0, score));
}

// ─────────────────────────────────────────────
// Main Entry Point
// ─────────────────────────────────────────────

export interface StrategyConfig {
  useOrderBlocks: boolean;
  useFairValueGaps: boolean;
  useLiquiditySweeps: boolean;
  useBOS: boolean;
  useChoCH: boolean;
  minRR: number;
  minConfidence: number;
  enabledKillZones: string[];
}

export async function analyzeMarket(
  epic: string,
  market: string,
  monthlyCandles: CapitalCandle[],
  weeklyCandles: CapitalCandle[],
  dailyCandles: CapitalCandle[],
  h4Candles: CapitalCandle[],
  h1Candles: CapitalCandle[],
  m15Candles: CapitalCandle[],
  currentBid: number,
  currentOffer: number,
  config: StrategyConfig
): Promise<ICTSignal | null> {
  try {
    if (
      monthlyCandles.length < 6 ||
      weeklyCandles.length < 8 ||
      dailyCandles.length < 10
    ) {
      return null;
    }

    const htfFlow = analyzeHTFOrderFlow(monthlyCandles, weeklyCandles, dailyCandles);

    if (!htfFlow.agreedDirection) {
      return null;
    }

    const allowedDirection = htfFlow.agreedDirection;

    const h4OHLC = candlesToOHLC(h4Candles);
    const h1OHLC = candlesToOHLC(h1Candles);
    const m15OHLC = candlesToOHLC(m15Candles);

    if (h4OHLC.length < 10 || h1OHLC.length < 10 || m15OHLC.length < 10) return null;

    const h4Structure = analyzeMarketStructure(h4OHLC);
    // H4 opposing HTF direction: soft confidence penalty (−15 pts).
    // Valid during HTF-aligned pullbacks (e.g. Monthly+Weekly BULLISH but H4
    // temporarily BEARISH). Not a veto on its own, but if H1 also conflicts,
    // the combined −30 pt penalty makes passing minConfidence very unlikely.
    const h4ConflictsHTF =
      h4Structure.trend !== "SIDEWAYS" &&
      ((allowedDirection === "BUY" && h4Structure.trend === "BEARISH") ||
        (allowedDirection === "SELL" && h4Structure.trend === "BULLISH"));

    const h1Structure = analyzeMarketStructure(h1OHLC);
    // H1 conflict check: if H1 also runs counter to the HTF direction,
    // this is a second penalty applied alongside the H4 conflict penalty.
    const h1ConflictsHTF =
      h1Structure.trend !== "SIDEWAYS" &&
      ((allowedDirection === "BUY" && h1Structure.trend === "BEARISH") ||
        (allowedDirection === "SELL" && h1Structure.trend === "BULLISH"));

    const m15Structure = analyzeMarketStructure(m15OHLC);

    const orderBlocks = config.useOrderBlocks ? detectOrderBlocks(m15OHLC, m15Structure) : [];
    const fvgs = config.useFairValueGaps ? detectFairValueGaps(m15OHLC) : [];
    const liquiditySweeps = config.useLiquiditySweeps
      ? detectLiquiditySweeps(m15OHLC, h1Structure)
      : [];

    const matchingOBs = orderBlocks.filter((ob) => ob.direction === allowedDirection);
    const matchingFVGs = fvgs.filter((fvg) => fvg.direction === allowedDirection);
    const matchingSweeps = liquiditySweeps.filter((s) => s.direction === allowedDirection);
    const hasBOS = config.useBOS && h1Structure.lastBOS?.direction === allowedDirection;
    const hasChoCH = config.useChoCH && m15Structure.lastChoCH?.direction === allowedDirection;

    const hasEntryConfluence =
      matchingOBs.length > 0 ||
      matchingFVGs.length > 0 ||
      matchingSweeps.length > 0 ||
      hasBOS ||
      hasChoCH;

    if (!hasEntryConfluence) return null;

    const killZone = getCurrentKillZone();
    const inKillZone = killZone !== null && config.enabledKillZones.includes(killZone);

    const dailyAligned = htfFlow.daily.bias !== "SIDEWAYS" &&
      ((allowedDirection === "BUY" && htfFlow.daily.bias === "BULLISH") ||
        (allowedDirection === "SELL" && htfFlow.daily.bias === "BEARISH"));

    const confidence = calculateConfidence({
      htfAlignmentCount: htfFlow.alignmentCount,
      htfAllThreeAligned: htfFlow.alignmentCount === 3,
      signalDirection: allowedDirection,
      hasOrderBlock: matchingOBs.length > 0,
      hasFVG: matchingFVGs.length > 0,
      hasLiquiditySweep: matchingSweeps.length > 0,
      hasBOS,
      hasChoCH,
      inKillZone,
      dailyAligned,
      h4ConflictsHTF, // −15 pts when H4 counter-trend
      h1ConflictsHTF, // −15 pts when H1 also counter-trend (stacks with H4)
    });

    if (confidence < config.minConfidence) return null;

    const currentPrice = (currentBid + currentOffer) / 2;

    const bestOB =
      matchingOBs.sort((a, b) => {
        const aDist = Math.abs(currentPrice - (a.top + a.bottom) / 2);
        const bDist = Math.abs(currentPrice - (b.top + b.bottom) / 2);
        return aDist - bDist;
      })[0] ?? null;

    const bestFVG =
      matchingFVGs.sort((a, b) => {
        const aDist = Math.abs(currentPrice - a.midpoint);
        const bDist = Math.abs(currentPrice - b.midpoint);
        return aDist - bDist;
      })[0] ?? null;

    // Pass recent swing points so calculateEntryParams can fall back to them
    // when no Order Block or FVG is present (fixes Bug #1).
    const recentSwingHigh = m15Structure.swingHighs.at(-1)?.price;
    const recentSwingLow  = m15Structure.swingLows.at(-1)?.price;

    const entryParams = calculateEntryParams(
      allowedDirection,
      bestOB,
      bestFVG,
      currentPrice,
      config.minRR,
      recentSwingHigh,
      recentSwingLow,
    );
    if (!entryParams) return null;

    const components: string[] = [];
    if (matchingOBs.length > 0) components.push("ORDER_BLOCK");
    if (matchingFVGs.length > 0) components.push("FVG");
    if (matchingSweeps.length > 0) components.push("LIQUIDITY_SWEEP");
    if (hasBOS) components.push("BOS");
    if (hasChoCH) components.push("CHOCH");

    const signalType: SignalType =
      components.length === 1 ? (components[0] as SignalType) : "COMBINED";

    const notes = [
      `=== HTF ORDER FLOW ===`,
      htfFlow.monthly.summary,
      htfFlow.weekly.summary,
      htfFlow.daily.summary,
      `HTF Decision: ${htfFlow.reason}`,
      `=== ENTRY ANALYSIS ===`,
      `H4: ${h4Structure.trend}${h4ConflictsHTF ? " ⚠ counter-trend (-15 pts)" : ""} | H1: ${h1Structure.trend}${h1ConflictsHTF ? " ⚠ counter-trend (-15 pts)" : ""} | M15: ${m15Structure.trend}`,
      `Entry confluences: ${components.join(", ")}`,
      `Kill Zone: ${killZone ?? "None"} | In KZ: ${inKillZone} | Confidence: ${confidence}%`,
      `OBs: ${matchingOBs.length} | FVGs: ${matchingFVGs.length} | Sweeps: ${matchingSweeps.length}`,
    ].join(" | ");

    return {
      direction: allowedDirection,
      signalType,
      timeframe: "M15",
      entryPrice: entryParams.entry,
      stopLoss: entryParams.stop,
      takeProfit: entryParams.target,
      confidence,
      killZone,
      notes,
      htfBias: htfFlow.monthly.bias !== "SIDEWAYS" ? htfFlow.monthly.bias : htfFlow.weekly.bias,
      structureContext: `M:${htfFlow.monthly.bias} W:${htfFlow.weekly.bias} D:${htfFlow.daily.bias} H4:${h4Structure.trend} H1:${h1Structure.trend} M15:${m15Structure.trend}`,
    };
  } catch {
    return null;
  }
}
