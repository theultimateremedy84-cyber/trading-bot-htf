/**
 * ICT (Inner Circle Trader) Strategy Engine
 *
 * Multi-Timeframe Order Flow + Smart Money Concepts:
 *
 * MANDATORY HIGHER TIMEFRAME GATE (executed first):
 *   1. Monthly  — macro order flow bias
 *   2. Weekly   — intermediate order flow bias
 *   3. Daily    — near-term order flow bias
 *   All three must agree (or 2/3 with the 3rd SIDEWAYS, never OPPOSITE)
 *   before the lower-timeframe entry logic is even evaluated.
 *
 * ENTRY TIMEFRAME ANALYSIS (H4 → H1 → M15):
 *   - Market Structure (BOS / ChoCH)
 *   - Order Blocks
 *   - Fair Value Gaps (FVG)
 *   - Liquidity Sweeps
 *   - Kill Zones (London / New York)
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

// ─────────────────────────────────────────────
// Higher-Timeframe Order Flow Structures
// ─────────────────────────────────────────────

export interface OrderFlowLevel {
  timeframe: string;
  bias: Trend;
  /** 0–100 — how strong the bias conviction is */
  strength: number;
  prevCandleHigh: number;
  prevCandleLow: number;
  keyOrderBlock: OrderBlock | null;
  structure: MarketStructure;
  /** Useful context for notes */
  summary: string;
}

export interface HTFOrderFlow {
  monthly: OrderFlowLevel;
  weekly: OrderFlowLevel;
  daily: OrderFlowLevel;
  /**
   * Agreed direction — null when timeframes conflict.
   * A trade may only be opened when this is non-null.
   */
  agreedDirection: Direction | null;
  /** How many of the 3 TFs align with agreedDirection (0–3) */
  alignmentCount: number;
  /** Human-readable reason for accepting or rejecting */
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

/**
 * Determines order flow bias for a single timeframe.
 * Uses market structure + candle body direction + momentum to score conviction.
 */
function analyzeOrderFlow(candles: OHLC[], timeframe: string): OrderFlowLevel {
  const structure = analyzeMarketStructure(candles);

  // Score bullish vs bearish evidence
  let bullishScore = 0;
  let bearishScore = 0;

  // 1. Market structure trend (strongest signal — 40 pts)
  if (structure.trend === "BULLISH") bullishScore += 40;
  if (structure.trend === "BEARISH") bearishScore += 40;

  // 2. BOS direction (25 pts)
  if (structure.lastBOS?.direction === "BUY") bullishScore += 25;
  if (structure.lastBOS?.direction === "SELL") bearishScore += 25;

  // 3. Recent candle bodies (last 5 candles — 15 pts total, 3 each)
  const recent = candles.slice(-5);
  for (const c of recent) {
    if (c.close > c.open) bullishScore += 3;
    else if (c.close < c.open) bearishScore += 3;
  }

  // 4. Momentum: last close vs open 10 candles ago (10 pts)
  if (candles.length >= 10) {
    const tenBack = candles[candles.length - 10];
    const last = candles[candles.length - 1];
    if (last.close > tenBack.open) bullishScore += 10;
    else if (last.close < tenBack.open) bearishScore += 10;
  }

  // 5. Higher highs / Higher lows pattern (10 pts)
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

  // Key order block on this timeframe
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
 * Runs Monthly → Weekly → Daily order flow analysis.
 * Returns the agreed direction (or null if timeframes conflict).
 *
 * Gate rules:
 *   - If ANY timeframe is OPPOSITE to the majority → reject (return null direction)
 *   - All three BULLISH → BUY allowed
 *   - All three BEARISH → SELL allowed
 *   - 2 BULLISH + 1 SIDEWAYS → BUY allowed (reduced conviction)
 *   - 2 BEARISH + 1 SIDEWAYS → SELL allowed (reduced conviction)
 *   - Any split (1B/1Be/1S or mixed) → reject
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

  // Hard reject: any timeframe directly opposes the majority
  const hasConflict =
    (bullishCount >= 2 && bearishCount >= 1) ||
    (bearishCount >= 2 && bullishCount >= 1);

  let agreedDirection: Direction | null = null;
  let alignmentCount = 0;
  let reason = "";

  if (hasConflict) {
    agreedDirection = null;
    alignmentCount = Math.max(bullishCount, bearishCount);
    reason =
      `HTF CONFLICT — Monthly:${monthly.bias} Weekly:${weekly.bias} Daily:${daily.bias}. ` +
      `Trade BLOCKED: higher timeframes disagree. Wait for alignment.`;
  } else if (bullishCount >= 2) {
    agreedDirection = "BUY";
    alignmentCount = bullishCount;
    reason =
      bullishCount === 3
        ? `ALL 3 HTFs BULLISH — Monthly:BULLISH Weekly:BULLISH Daily:BULLISH. Full BUY alignment.`
        : `2/3 HTFs BULLISH (${levels.find((l) => l.bias !== "BULLISH")?.timeframe ?? "?"} is SIDEWAYS). BUY allowed with reduced conviction.`;
  } else if (bearishCount >= 2) {
    agreedDirection = "SELL";
    alignmentCount = bearishCount;
    reason =
      bearishCount === 3
        ? `ALL 3 HTFs BEARISH — Monthly:BEARISH Weekly:BEARISH Daily:BEARISH. Full SELL alignment.`
        : `2/3 HTFs BEARISH (${levels.find((l) => l.bias !== "BEARISH")?.timeframe ?? "?"} is SIDEWAYS). SELL allowed with reduced conviction.`;
  } else {
    // All sideways or 1/1/1 split
    agreedDirection = null;
    alignmentCount = 0;
    reason = `No HTF alignment — Monthly:${monthly.bias} Weekly:${weekly.bias} Daily:${daily.bias}. Market is ranging or transitioning. No trade.`;
  }

  return { monthly, weekly, daily, agreedDirection, alignmentCount, reason };
}

// ─────────────────────────────────────────────
// Entry-TF Analysis (existing logic)
// ─────────────────────────────────────────────

export function detectOrderBlocks(candles: OHLC[], structure: MarketStructure): OrderBlock[] {
  const blocks: OrderBlock[] = [];
  const lastN = candles.slice(-50);

  for (let i = 1; i < lastN.length - 3; i++) {
    const c = lastN[i];
    const next = lastN[i + 1];
    const afterNext = lastN[i + 2];

    // Bullish OB: last bearish candle before a strong bullish impulsive move
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

    // Bearish OB: last bullish candle before a strong bearish impulsive move
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

export function calculateEntryParams(
  direction: Direction,
  orderBlock: OrderBlock | null,
  fvg: FairValueGap | null,
  currentPrice: number,
  minRR: number
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
    } else return null;
    target = entry + Math.abs(entry - stop) * minRR;
  } else {
    if (orderBlock) {
      entry = (orderBlock.top + orderBlock.bottom) / 2;
      stop = orderBlock.top * 1.0005;
    } else if (fvg) {
      entry = fvg.midpoint;
      stop = fvg.top * 1.0005;
    } else return null;
    target = entry - Math.abs(stop - entry) * minRR;
  }

  const risk = Math.abs(entry - stop);
  const reward = Math.abs(target - entry);
  return { entry, stop, target, rr: risk > 0 ? reward / risk : 0 };
}

// ─────────────────────────────────────────────
// Confidence Scoring (updated for HTF order flow)
// ─────────────────────────────────────────────

export function calculateConfidence(params: {
  htfAlignmentCount: number; // 2 or 3
  htfAllThreeAligned: boolean;
  signalDirection: Direction;
  hasOrderBlock: boolean;
  hasFVG: boolean;
  hasLiquiditySweep: boolean;
  hasBOS: boolean;
  hasChoCH: boolean;
  inKillZone: boolean;
  dailyAligned: boolean;
}): number {
  let score = 0;

  // Monthly + Weekly + Daily order flow gate (primary weight — 45 pts max)
  if (params.htfAllThreeAligned) {
    score += 45; // All 3 TFs agree — highest conviction
  } else if (params.htfAlignmentCount >= 2) {
    score += 30; // 2/3 agree (3rd is SIDEWAYS)
  }

  // Daily specifically aligned adds bonus (overlaps with above but rewards M→W→D cascade)
  if (params.dailyAligned) score += 5;

  // Kill zone timing (15 pts)
  if (params.inKillZone) score += 15;

  // Entry TF confluences
  if (params.hasLiquiditySweep) score += 12; // strongest LTF signal
  if (params.hasOrderBlock) score += 10;
  if (params.hasBOS) score += 8;
  if (params.hasFVG) score += 7;
  if (params.hasChoCH) score += 5;

  // Bonus: OB + FVG stack (institutional confluence)
  if (params.hasOrderBlock && params.hasFVG) score += 3;

  return Math.min(100, score);
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

/**
 * Full multi-timeframe ICT analysis.
 *
 * Execution order:
 *   1. Monthly order flow → Weekly order flow → Daily order flow (HARD GATE)
 *   2. H4 structure confirmation
 *   3. H1 intermediate structure
 *   4. M15 entry logic (OB, FVG, Sweep, BOS, ChoCH)
 *   5. Kill zone check
 *   6. Confidence scoring
 *   7. Entry parameter calculation (size, SL, TP)
 */
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
    // ── STEP 1: HTF ORDER FLOW GATE ──────────────────────────────────────
    // Require sufficient candle history on each TF (min 6 monthly, 8 weekly, 10 daily)
    if (
      monthlyCandles.length < 6 ||
      weeklyCandles.length < 8 ||
      dailyCandles.length < 10
    ) {
      return null; // not enough HTF data yet
    }

    const htfFlow = analyzeHTFOrderFlow(monthlyCandles, weeklyCandles, dailyCandles);

    if (!htfFlow.agreedDirection) {
      // HTF timeframes conflict or are not aligned — skip this market entirely
      return null;
    }

    const allowedDirection = htfFlow.agreedDirection;

    // ── STEP 2: H4 STRUCTURE (must not contradict HTF) ────────────────────
    const h4OHLC = candlesToOHLC(h4Candles);
    const h1OHLC = candlesToOHLC(h1Candles);
    const m15OHLC = candlesToOHLC(m15Candles);

    if (h4OHLC.length < 10 || h1OHLC.length < 10 || m15OHLC.length < 10) return null;

    const h4Structure = analyzeMarketStructure(h4OHLC);
    // H4 can be SIDEWAYS (transitioning), but must not be OPPOSITE
    if (
      h4Structure.trend !== "SIDEWAYS" &&
      ((allowedDirection === "BUY" && h4Structure.trend === "BEARISH") ||
        (allowedDirection === "SELL" && h4Structure.trend === "BULLISH"))
    ) {
      return null; // H4 opposes HTF order flow — skip
    }

    // ── STEP 3: H1 STRUCTURE ─────────────────────────────────────────────
    const h1Structure = analyzeMarketStructure(h1OHLC);

    // ── STEP 4: M15 ENTRY LOGIC ───────────────────────────────────────────
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

    // Require at least one entry-TF confluence
    const hasEntryConfluence =
      matchingOBs.length > 0 ||
      matchingFVGs.length > 0 ||
      matchingSweeps.length > 0 ||
      hasBOS ||
      hasChoCH;

    if (!hasEntryConfluence) return null;

    // ── STEP 5: KILL ZONE ─────────────────────────────────────────────────
    const killZone = getCurrentKillZone();
    const inKillZone = killZone !== null && config.enabledKillZones.includes(killZone);

    // ── STEP 6: CONFIDENCE SCORE ──────────────────────────────────────────
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
    });

    if (confidence < config.minConfidence) return null;

    // ── STEP 7: ENTRY PARAMETERS ──────────────────────────────────────────
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

    const entryParams = calculateEntryParams(allowedDirection, bestOB, bestFVG, currentPrice, config.minRR);
    if (!entryParams) return null;

    // ── ASSEMBLE SIGNAL ───────────────────────────────────────────────────
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
      `H4: ${h4Structure.trend} | H1: ${h1Structure.trend} | M15: ${m15Structure.trend}`,
      `Entry confluences: ${components.join(", ")}`,
      `Kill Zone: ${killZone ?? "None"} | Confidence: ${confidence}%`,
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
