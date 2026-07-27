import { useParams, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, CheckCircle2, XCircle, MinusCircle, AlertTriangle } from "lucide-react";
import { formatNumber, formatDateShort, cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SignalDetail {
  id: number;
  epic: string;
  market: string;
  direction: "BUY" | "SELL";
  signalType: string;
  timeframe: string;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  confidence: number;
  detectedAt: string;
  executed: boolean;
  killZone: "LONDON" | "NEW_YORK" | "ASIAN" | null;
  notes: string | null;
  htfBias: string | null;
  structureContext: string | null;
  rrRatio: number;
}

// ─── Parsers ─────────────────────────────────────────────────────────────────

/**
 * Parse structureContext string: "M:BULLISH W:BULLISH D:BEARISH H4:BEARISH H1:BULLISH M15:BULLISH"
 * Returns a map of timeframe label → bias.
 */
function parseTFContext(ctx: string | null): Record<string, string> {
  if (!ctx) return {};
  return Object.fromEntries(
    ctx
      .split(" ")
      .map((pair) => pair.split(":"))
      .filter(([k, v]) => k && v)
  );
}

/**
 * Parse the pipe-separated notes string into named sections.
 * The notes are assembled in ictStrategy.ts as:
 *   "=== HTF ORDER FLOW === | {monthly summary} | {weekly summary} | {daily summary} |
 *    HTF Decision: {reason} | === ENTRY ANALYSIS === | H4: ... | H1: ... | M15: ... |
 *    Entry confluences: ... | Kill Zone: ... | In KZ: ... | Confidence: N% |
 *    OBs: N | FVGs: N | Sweeps: N"
 */
function parseNotes(notes: string | null) {
  if (!notes) return null;

  const parts = notes.split(" | ");

  const htfStart = parts.findIndex((p) => p.includes("HTF ORDER FLOW"));
  const entryStart = parts.findIndex((p) => p.includes("ENTRY ANALYSIS"));

  const htfRaw = htfStart >= 0 ? parts.slice(htfStart + 1, entryStart >= 0 ? entryStart : undefined) : [];
  const entryRaw = entryStart >= 0 ? parts.slice(entryStart + 1) : [];

  // Pull named items out of each section
  const htfDecision = htfRaw.find((p) => p.startsWith("HTF Decision:"))?.replace("HTF Decision: ", "") ?? "";
  const monthly = htfRaw.find((p) => p.startsWith("Monthly:")) ?? "";
  const weekly = htfRaw.find((p) => p.startsWith("Weekly:")) ?? "";
  const daily = htfRaw.find((p) => p.startsWith("Daily:")) ?? "";

  // Extra HTF details that sit between the timeframe headers (BOS, ChoCH, OB level, pattern)
  // They don't have a leading label we can key on, so we collect anything not already matched.
  const knownHTFPrefixes = ["Monthly:", "Weekly:", "Daily:", "HTF Decision:", "=== HTF ORDER FLOW ==="];
  const htfDetails = htfRaw.filter(
    (p) => !knownHTFPrefixes.some((prefix) => p.startsWith(prefix) || p === prefix)
  );

  const confluencePart = entryRaw.find((p) => p.startsWith("Entry confluences:"));
  const confluences = confluencePart
    ? confluencePart.replace("Entry confluences: ", "").split(", ").filter(Boolean)
    : [];

  const killZonePart = entryRaw.find((p) => p.startsWith("Kill Zone:")) ?? "";
  const countsPart = entryRaw.find((p) => p.startsWith("OBs:")) ?? "";
  const h4CounterTrend = entryRaw.some((p) => p.includes("counter-trend"));

  // Parse counts: "OBs: 1 | FVGs: 2 | Sweeps: 0"
  const obMatch = countsPart.match(/OBs:\s*(\d+)/);
  const fvgMatch = countsPart.match(/FVGs:\s*(\d+)/);
  const sweepMatch = countsPart.match(/Sweeps:\s*(\d+)/);
  const obCount = obMatch ? parseInt(obMatch[1]) : 0;
  const fvgCount = fvgMatch ? parseInt(fvgMatch[1]) : 0;
  const sweepCount = sweepMatch ? parseInt(sweepMatch[1]) : 0;

  // Detect BOS / ChoCH from entry confluences
  const hasBOS = confluences.includes("BOS");
  const hasChoCH = confluences.includes("CHOCH");
  const hasOB = obCount > 0 || confluences.includes("ORDER_BLOCK");
  const hasFVG = fvgCount > 0 || confluences.includes("FVG");
  const hasSweep = sweepCount > 0 || confluences.includes("LIQUIDITY_SWEEP");
  const inKillZone = killZonePart.includes("In KZ: true");

  return {
    htfDecision,
    monthly,
    weekly,
    daily,
    htfDetails,
    confluences,
    killZonePart,
    countsPart,
    h4CounterTrend,
    obCount,
    fvgCount,
    sweepCount,
    hasBOS,
    hasChoCH,
    hasOB,
    hasFVG,
    hasSweep,
    inKillZone,
  };
}

// ─── Score breakdown ──────────────────────────────────────────────────────────

interface ScoreFactor {
  label: string;
  description: string;
  points: number;
  active: boolean;
}

function buildScoreBreakdown(signal: SignalDetail, parsed: NonNullable<ReturnType<typeof parseNotes>>, tfContext: Record<string, string>): ScoreFactor[] {
  const dir = signal.direction;

  // HTF alignment
  const htfBiases = [tfContext["M"], tfContext["W"], tfContext["D"]].filter(Boolean);
  const aligned = htfBiases.filter((b) =>
    dir === "BUY" ? b === "BULLISH" : b === "BEARISH"
  ).length;
  const allThree = aligned === 3;
  const twoOfThree = aligned === 2;

  // Daily alignment (separate bonus)
  const dailyBias = tfContext["D"];
  const dailyAligned = dailyBias && (dir === "BUY" ? dailyBias === "BULLISH" : dailyBias === "BEARISH");

  return [
    {
      label: "All 3 HTFs Aligned",
      description: "Monthly, Weekly, and Daily all agree on direction (+45 pts)",
      points: 45,
      active: allThree,
    },
    {
      label: "2/3 HTFs Aligned",
      description: "Two of three higher timeframes agree on direction (+30 pts)",
      points: 30,
      active: !allThree && twoOfThree,
    },
    {
      label: "Daily TF Aligned",
      description: "Daily bias matches the trade direction (+5 pts)",
      points: 5,
      active: !!dailyAligned,
    },
    {
      label: `Kill Zone (${signal.killZone ?? "None"})`,
      description: "Trade detected during a high-probability session window (+15 pts)",
      points: 15,
      active: parsed.inKillZone,
    },
    {
      label: `Liquidity Sweep (${parsed.sweepCount})`,
      description: "Stop-hunt / liquidity grab detected before reversal (+12 pts)",
      points: 12,
      active: parsed.hasSweep,
    },
    {
      label: `Order Block (${parsed.obCount})`,
      description: "Institutional order block found at entry zone (+10 pts)",
      points: 10,
      active: parsed.hasOB,
    },
    {
      label: "Break of Structure",
      description: "Market broke a prior swing high/low in the trade direction (+8 pts)",
      points: 8,
      active: parsed.hasBOS,
    },
    {
      label: `Fair Value Gap (${parsed.fvgCount})`,
      description: "Imbalance / FVG present at entry — price seeks to fill the gap (+7 pts)",
      points: 7,
      active: parsed.hasFVG,
    },
    {
      label: "Change of Character",
      description: "Market structure shifted — prior trend broken (+5 pts)",
      points: 5,
      active: parsed.hasChoCH,
    },
    {
      label: "OB + FVG Confluence",
      description: "Order block and FVG overlap — strongest entry zone combination (+3 pts)",
      points: 3,
      active: parsed.hasOB && parsed.hasFVG,
    },
    {
      label: "H4 Counter-Trend Penalty",
      description: "H4 trend opposes the HTF direction (pullback entry — confidence reduced by 15 pts)",
      points: -15,
      active: parsed.h4CounterTrend,
    },
  ];
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function TrendBadge({ bias }: { bias: string }) {
  const color =
    bias === "BULLISH"
      ? "text-primary border-primary/30 bg-primary/10"
      : bias === "BEARISH"
      ? "text-destructive border-destructive/30 bg-destructive/10"
      : "text-muted-foreground border-border bg-muted/30";
  return (
    <span className={cn("rounded-sm border px-1.5 py-0.5 font-mono text-[10px] font-bold", color)}>
      {bias}
    </span>
  );
}

function FactorRow({ factor }: { factor: ScoreFactor }) {
  const Icon = factor.active
    ? factor.points < 0
      ? AlertTriangle
      : CheckCircle2
    : MinusCircle;
  const iconColor = factor.active
    ? factor.points < 0
      ? "text-yellow-500"
      : "text-primary"
    : "text-muted-foreground/40";
  const pointsColor = !factor.active
    ? "text-muted-foreground/40"
    : factor.points < 0
    ? "text-yellow-500"
    : "text-primary";

  return (
    <div className={cn("flex items-start gap-3 py-2.5 border-b border-border/40 last:border-0", !factor.active && "opacity-50")}>
      <Icon className={cn("h-4 w-4 mt-0.5 shrink-0", iconColor)} />
      <div className="flex-1 min-w-0">
        <div className="font-mono text-xs font-semibold">{factor.label}</div>
        <div className="font-mono text-[10px] text-muted-foreground mt-0.5 leading-snug">{factor.description}</div>
      </div>
      <div className={cn("font-mono text-sm font-bold shrink-0", pointsColor)}>
        {factor.active ? (factor.points > 0 ? `+${factor.points}` : factor.points) : "—"}
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function SignalDetail() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const signalId = Number(id);

  const { data: signal, isLoading, error } = useQuery<SignalDetail>({
    queryKey: [`/api/signals/${signalId}`],
    queryFn: async ({ signal: abortSignal }) => {
      const res = await fetch(`/api/signals/${signalId}`, { signal: abortSignal });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return res.json();
    },
    enabled: !isNaN(signalId) && signalId > 0,
  });

  if (isNaN(signalId) || signalId <= 0) {
    return (
      <div className="p-8 text-center font-mono text-destructive">INVALID_SIGNAL_ID</div>
    );
  }

  if (isLoading) {
    return <div className="p-8 text-center font-mono text-muted-foreground">LOADING_SIGNAL...</div>;
  }

  if (error || !signal) {
    return (
      <div className="p-8 text-center space-y-2">
        <div className="font-mono text-destructive font-bold">SIGNAL_NOT_FOUND</div>
        <div className="font-mono text-xs text-muted-foreground">Signal #{id} does not exist or failed to load.</div>
        <Button variant="outline" size="sm" className="mt-4" onClick={() => navigate("/signals")}>
          <ArrowLeft className="h-4 w-4 mr-2" /> Back to Signals
        </Button>
      </div>
    );
  }

  const parsed = parseNotes(signal.notes);
  const tfContext = parseTFContext(signal.structureContext);
  const scoreFactors = parsed ? buildScoreBreakdown(signal, parsed, tfContext) : [];
  const activeScore = scoreFactors.filter((f) => f.active).reduce((sum, f) => sum + f.points, 0);

  const TF_LABELS: Record<string, string> = {
    M: "Monthly",
    W: "Weekly",
    D: "Daily",
    H4: "H4",
    H1: "H1",
    M15: "M15",
  };

  return (
    <div className="space-y-6 max-w-4xl">

      {/* Header */}
      <div className="flex items-start gap-4">
        <Button variant="ghost" size="icon" className="mt-1 h-8 w-8 shrink-0" onClick={() => navigate("/signals")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <h1 className="text-2xl font-bold tracking-tight font-mono">{signal.market}</h1>
            <Badge variant={signal.direction === "BUY" ? "default" : "destructive"} className="text-sm px-2">
              {signal.direction}
            </Badge>
            {signal.executed && (
              <Badge variant="outline" className="text-[10px] border-primary/40 text-primary">EXECUTED</Badge>
            )}
            {signal.killZone && (
              <Badge variant="outline" className="text-[10px]">{signal.killZone} SESSION</Badge>
            )}
          </div>
          <p className="text-xs font-mono text-muted-foreground">
            Signal #{signal.id} · {signal.signalType.replace(/_/g, " ")} · {signal.timeframe} · Detected {formatDateShort(signal.detectedAt)}
          </p>
        </div>
      </div>

      {/* Trade Parameters */}
      <Card className="border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-xs font-semibold uppercase text-muted-foreground">Trade Parameters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 font-mono">
            <div>
              <div className="text-[10px] text-muted-foreground uppercase mb-1">Entry Price</div>
              <div className="text-lg font-bold">{formatNumber(signal.entryPrice)}</div>
            </div>
            <div>
              <div className="text-[10px] text-muted-foreground uppercase mb-1">Stop Loss</div>
              <div className="text-lg font-bold text-destructive">{formatNumber(signal.stopLoss)}</div>
            </div>
            <div>
              <div className="text-[10px] text-muted-foreground uppercase mb-1">Take Profit</div>
              <div className="text-lg font-bold text-primary">{formatNumber(signal.takeProfit)}</div>
            </div>
            <div>
              <div className="text-[10px] text-muted-foreground uppercase mb-1">Risk : Reward</div>
              <div className="text-lg font-bold">1 : {signal.rrRatio.toFixed(2)}</div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">

        {/* Confidence Score Breakdown */}
        <Card className="border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-xs font-semibold uppercase text-muted-foreground">
              Confidence Score Breakdown
            </CardTitle>
            <p className="text-[10px] font-mono text-muted-foreground mt-1">
              How each factor contributed to the {signal.confidence}% confidence rating
            </p>
          </CardHeader>
          <CardContent className="pt-0">
            {/* Score bar */}
            <div className="mb-4">
              <div className="flex justify-between text-xs font-mono mb-1.5">
                <span className="text-muted-foreground">Computed score</span>
                <span className={cn(
                  "font-bold",
                  signal.confidence > 70 ? "text-primary" : signal.confidence > 50 ? "text-yellow-500" : "text-destructive"
                )}>
                  {signal.confidence}%
                </span>
              </div>
              <div className="h-2 w-full bg-secondary rounded-full overflow-hidden">
                <div
                  className={cn(
                    "h-full rounded-full transition-all",
                    signal.confidence > 70 ? "bg-primary" : signal.confidence > 50 ? "bg-yellow-500" : "bg-destructive"
                  )}
                  style={{ width: `${signal.confidence}%` }}
                />
              </div>
              <div className="flex justify-between text-[10px] font-mono mt-1 text-muted-foreground">
                <span>Active factors sum: {activeScore > 0 ? `+${activeScore}` : activeScore} → capped at 100</span>
              </div>
            </div>

            {scoreFactors.length > 0 ? (
              <div>
                {scoreFactors.map((factor) => (
                  <FactorRow key={factor.label} factor={factor} />
                ))}
              </div>
            ) : (
              <div className="text-center py-4 text-xs font-mono text-muted-foreground">
                Score detail unavailable — notes not stored for this signal
              </div>
            )}
          </CardContent>
        </Card>

        {/* Multi-Timeframe Structure */}
        <div className="space-y-4">
          <Card className="border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-xs font-semibold uppercase text-muted-foreground">
                Multi-Timeframe Alignment
              </CardTitle>
              <p className="text-[10px] font-mono text-muted-foreground mt-1">
                The bot requires ≥2/3 higher timeframes to agree before a signal is considered
              </p>
            </CardHeader>
            <CardContent className="pt-0">
              {Object.keys(tfContext).length > 0 ? (
                <div className="grid grid-cols-3 gap-2">
                  {Object.entries(TF_LABELS).map(([key, label]) => {
                    const bias = tfContext[key];
                    if (!bias) return null;
                    const isHTF = ["M", "W", "D"].includes(key);
                    return (
                      <div
                        key={key}
                        className={cn(
                          "rounded-sm border p-2 text-center",
                          isHTF ? "border-border/80" : "border-border/40 opacity-80"
                        )}
                      >
                        <div className="text-[9px] font-mono text-muted-foreground uppercase mb-1">{label}</div>
                        <TrendBadge bias={bias} />
                        {isHTF && (
                          <div className="text-[9px] font-mono text-muted-foreground mt-1">
                            {bias === (signal.direction === "BUY" ? "BULLISH" : "BEARISH") ? "✓ aligned" : bias === "SIDEWAYS" ? "~ neutral" : "✗ opposite"}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center text-xs font-mono text-muted-foreground py-4">
                  Structure context not available for this signal
                </div>
              )}
            </CardContent>
          </Card>

          {/* HTF Decision */}
          {parsed?.htfDecision && (
            <Card className="border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-semibold uppercase text-muted-foreground">HTF Gate Decision</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <p className="font-mono text-xs leading-relaxed text-foreground/80">{parsed.htfDecision}</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* HTF Order Flow Detail */}
      {parsed && (parsed.monthly || parsed.weekly || parsed.daily) && (
        <Card className="border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-xs font-semibold uppercase text-muted-foreground">HTF Order Flow Detail</CardTitle>
            <p className="text-[10px] font-mono text-muted-foreground mt-1">
              Structure analysis from each higher timeframe that fed into the gate decision
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            {[
              { label: "Monthly", value: parsed.monthly },
              { label: "Weekly", value: parsed.weekly },
              { label: "Daily", value: parsed.daily },
            ].map(({ label, value }) =>
              value ? (
                <div key={label} className="rounded-sm border border-border/50 p-3">
                  <div className="text-[10px] font-mono text-muted-foreground uppercase mb-1.5">{label}</div>
                  <p className="font-mono text-xs text-foreground/90 leading-relaxed">{value}</p>
                </div>
              ) : null
            )}
            {parsed.htfDetails.length > 0 && (
              <div className="rounded-sm border border-border/30 p-3 bg-muted/20">
                <div className="text-[10px] font-mono text-muted-foreground uppercase mb-1.5">Additional Context</div>
                <ul className="space-y-1">
                  {parsed.htfDetails.map((detail, i) => (
                    <li key={i} className="font-mono text-xs text-foreground/70">· {detail}</li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Entry Analysis */}
      {parsed && (parsed.confluences.length > 0 || parsed.countsPart) && (
        <Card className="border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-xs font-semibold uppercase text-muted-foreground">Entry-Timeframe Analysis</CardTitle>
            <p className="text-[10px] font-mono text-muted-foreground mt-1">
              What was detected on H4 / H1 / M15 at signal generation time
            </p>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              <div className="rounded-sm border border-border/50 p-2 text-center">
                <div className="text-[10px] font-mono text-muted-foreground mb-1">Order Blocks</div>
                <div className={cn("text-xl font-bold font-mono", parsed.obCount > 0 ? "text-primary" : "text-muted-foreground")}>{parsed.obCount}</div>
              </div>
              <div className="rounded-sm border border-border/50 p-2 text-center">
                <div className="text-[10px] font-mono text-muted-foreground mb-1">Fair Value Gaps</div>
                <div className={cn("text-xl font-bold font-mono", parsed.fvgCount > 0 ? "text-primary" : "text-muted-foreground")}>{parsed.fvgCount}</div>
              </div>
              <div className="rounded-sm border border-border/50 p-2 text-center">
                <div className="text-[10px] font-mono text-muted-foreground mb-1">Liq. Sweeps</div>
                <div className={cn("text-xl font-bold font-mono", parsed.sweepCount > 0 ? "text-primary" : "text-muted-foreground")}>{parsed.sweepCount}</div>
              </div>
              <div className="rounded-sm border border-border/50 p-2 text-center">
                <div className="text-[10px] font-mono text-muted-foreground mb-1">Session</div>
                <div className={cn("text-base font-bold font-mono", parsed.inKillZone ? "text-primary" : "text-muted-foreground")}>
                  {signal.killZone ?? "OFF-KZ"}
                </div>
              </div>
            </div>

            {parsed.confluences.length > 0 && (
              <div className="flex flex-wrap gap-2">
                <span className="text-[10px] font-mono text-muted-foreground self-center">Active confluences:</span>
                {parsed.confluences.map((c) => (
                  <Badge key={c} variant="outline" className="text-[10px] font-mono border-primary/40 text-primary">
                    {c.replace(/_/g, " ")}
                  </Badge>
                ))}
              </div>
            )}

            {parsed.h4CounterTrend && (
              <div className="mt-3 flex items-start gap-2 rounded-sm border border-yellow-500/30 bg-yellow-500/10 p-3">
                <AlertTriangle className="h-4 w-4 text-yellow-500 shrink-0 mt-0.5" />
                <p className="font-mono text-xs text-yellow-500/90">
                  H4 is trending counter to the HTF direction — this is normal during pullback entries but reduces confidence by 15 points. The trade is still valid as the higher timeframe majority is aligned.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

    </div>
  );
}
