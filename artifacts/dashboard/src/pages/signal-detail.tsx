import { useParams, useLocation } from "wouter";
import { useGetSignals } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatNumber, formatDateShort, cn } from "@/lib/utils";
import {
  ArrowLeft,
  TrendingUp,
  TrendingDown,
  Shield,
  Target,
  Zap,
  BarChart3,
  AlertTriangle,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ParsedNotes {
  htfFlow: string[];
  entryAnalysis: string[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Split the pipe-separated notes blob into HTF and entry sections. */
function parseNotes(notes: string | null | undefined): ParsedNotes | null {
  if (!notes) return null;
  const parts = notes.split(" | ");
  const result: ParsedNotes = { htfFlow: [], entryAnalysis: [] };
  let section: "htf" | "entry" | "" = "";
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.includes("HTF ORDER FLOW")) { section = "htf"; continue; }
    if (trimmed.includes("ENTRY ANALYSIS")) { section = "entry"; continue; }
    if (!trimmed) continue;
    if (section === "htf") result.htfFlow.push(trimmed);
    if (section === "entry") result.entryAnalysis.push(trimmed);
  }
  return result;
}

// ─── Signal-type metadata ─────────────────────────────────────────────────────

const SIGNAL_META: Record<string, { label: string; description: string }> = {
  ORDER_BLOCK: {
    label: "Order Block",
    description:
      "An institutional order-accumulation zone — a candle whose body caused a significant reversal, indicating that large BUY or SELL orders were placed here. Price frequently returns to these zones before continuing.",
  },
  FAIR_VALUE_GAP: {
    label: "Fair Value Gap (FVG)",
    description:
      "A price imbalance between buyers and sellers that leaves a visible gap in the market. Smart money algorithms typically revisit these gaps to fill inefficiency before resuming the directional move.",
  },
  LIQUIDITY_SWEEP: {
    label: "Liquidity Sweep",
    description:
      "Price briefly pushed past a prior swing high or low to trigger retail stop-losses, then immediately reversed. This is a Smart Money manipulation pattern — institutions collect liquidity before the real move.",
  },
  BOS: {
    label: "Break of Structure (BOS)",
    description:
      "Price broke decisively through a previous swing high (for BUY) or swing low (for SELL), confirming that the prevailing trend is continuing. A BOS on the H1 timeframe validates the HTF bias.",
  },
  CHOCH: {
    label: "Change of Character (ChoCH)",
    description:
      "A structural shift indicating a potential reversal: price broke through a level that was previously holding the trend. ChoCH is the earliest warning that the prior swing is now invalidated.",
  },
  COMBINED: {
    label: "Combined Setup",
    description:
      "Multiple ICT concepts fired simultaneously. This is the strongest signal type — when an Order Block, FVG, Liquidity Sweep, or structure event all point in the same direction at once, conviction is highest.",
  },
};

// ─── Confidence row data ──────────────────────────────────────────────────────

function buildScoreRows(signal: {
  signalType: string;
  killZone: string | null;
  confidence: number;
}) {
  const st = signal.signalType;
  const hasSweep = st === "LIQUIDITY_SWEEP" || st === "COMBINED";
  const hasOB = st === "ORDER_BLOCK" || st === "COMBINED";
  const hasBOS = st === "BOS" || st === "COMBINED";
  const hasFVG = st === "FAIR_VALUE_GAP" || st === "COMBINED";
  const hasChoCH = st === "CHOCH" || st === "COMBINED";
  const inKZ = !!signal.killZone;

  // Infer HTF alignment from total score — can't know exact breakdown without
  // stored metadata, so we approximate from the total.
  const minWithAllThree = 45; // htfAllThreeAligned alone
  const htfAll = signal.confidence >= 55; // 45 + at least one other factor
  const htfMaj = !htfAll && signal.confidence >= 35;

  return [
    {
      label: "HTF Full Alignment (3/3)",
      description: "Monthly + Weekly + Daily all agree",
      pts: 45,
      active: htfAll,
    },
    {
      label: "HTF Majority (2/3)",
      description: "2 of 3 higher timeframes agree",
      pts: 30,
      active: htfMaj,
    },
    {
      label: "Kill Zone Active",
      description: `${signal.killZone ?? "No active session"} session`,
      pts: 15,
      active: inKZ,
    },
    {
      label: "Liquidity Sweep",
      description: "Stop-hunt reversal confirmed",
      pts: 12,
      active: hasSweep,
    },
    {
      label: "Order Block",
      description: "Institutional order zone",
      pts: 10,
      active: hasOB,
    },
    {
      label: "Break of Structure",
      description: "H1 trend confirmation",
      pts: 8,
      active: hasBOS,
    },
    {
      label: "Fair Value Gap",
      description: "Price imbalance filled",
      pts: 7,
      active: hasFVG,
    },
    {
      label: "OB + FVG Confluence",
      description: "Both present simultaneously",
      pts: 3,
      active: hasOB && hasFVG,
    },
    {
      label: "Change of Character",
      description: "M15 structure shift",
      pts: 5,
      active: hasChoCH,
    },
  ];
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function SignalDetail() {
  const params = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const signalId = Number(params.id);

  // Re-use the signals list — avoids needing a new API endpoint or codegen run.
  const { data: signals, isLoading } = useGetSignals(
    { limit: 200 },
    { query: { refetchInterval: 30000 } }
  );

  const signal = signals?.find((s) => s.id === signalId);

  if (isLoading) {
    return (
      <div className="p-8 text-center font-mono text-muted-foreground">
        LOADING_SIGNAL...
      </div>
    );
  }

  if (!signal) {
    return (
      <div className="space-y-4">
        <Button
          variant="ghost"
          size="sm"
          className="font-mono text-xs"
          onClick={() => navigate("/signals")}
        >
          <ArrowLeft className="mr-2 h-3 w-3" /> BACK TO SIGNALS
        </Button>
        <div className="p-8 text-center font-mono text-muted-foreground border border-dashed border-border rounded-sm">
          SIGNAL_NOT_FOUND
        </div>
      </div>
    );
  }

  // Derived values
  const rr =
    signal.takeProfit && signal.stopLoss && signal.entryPrice
      ? Math.abs(signal.takeProfit - signal.entryPrice) /
        Math.abs(signal.entryPrice - signal.stopLoss)
      : 0;

  const riskPct =
    ((Math.abs(signal.entryPrice - signal.stopLoss) / signal.entryPrice) * 100).toFixed(3);
  const rewardPct =
    ((Math.abs(signal.takeProfit - signal.entryPrice) / signal.entryPrice) * 100).toFixed(3);

  const meta = SIGNAL_META[signal.signalType] ?? SIGNAL_META.COMBINED;
  const scoreRows = buildScoreRows(signal);
  const parsedNotes = parseNotes(signal.notes);

  const rrLabel =
    rr >= 2 ? "Excellent" : rr >= 1.5 ? "Good" : rr >= 1 ? "Acceptable" : "Poor";
  const rrColor =
    rr >= 2 ? "text-primary" : rr >= 1.5 ? "text-yellow-500" : rr >= 1 ? "text-yellow-600" : "text-destructive";

  return (
    <div className="space-y-6">
      {/* Back button */}
      <Button
        variant="ghost"
        size="sm"
        className="font-mono text-xs -ml-2"
        onClick={() => navigate("/signals")}
      >
        <ArrowLeft className="mr-2 h-3 w-3" /> BACK TO SIGNALS
      </Button>

      {/* Header */}
      <div className="flex flex-wrap items-start gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight font-sans">{signal.market}</h1>
          <p className="text-muted-foreground font-mono text-xs mt-1">
            {signal.epic} · Detected {formatDateShort(signal.detectedAt)}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap mt-1">
          <Badge
            variant={signal.direction === "BUY" ? "default" : "destructive"}
            className="font-mono"
          >
            {signal.direction === "BUY" ? (
              <TrendingUp className="mr-1 h-3 w-3" />
            ) : (
              <TrendingDown className="mr-1 h-3 w-3" />
            )}
            {signal.direction}
          </Badge>
          {signal.killZone && (
            <Badge variant="outline" className="font-mono text-xs">
              {signal.killZone} KILL ZONE
            </Badge>
          )}
          {signal.executed && (
            <Badge variant="secondary" className="font-mono text-xs">
              EXECUTED
            </Badge>
          )}
        </div>
      </div>

      {/* Signal Reason */}
      <Card className="border-primary/30 bg-primary/5">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold uppercase text-muted-foreground flex items-center gap-2">
            <Zap className="h-4 w-4 text-primary" /> Why This Signal Was Generated
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="font-mono font-bold text-base text-foreground">{meta.label}</div>
          <p className="text-sm text-muted-foreground leading-relaxed">{meta.description}</p>

          {/* Raw notes summary */}
          {signal.notes && (
            <div className="mt-2 space-y-1">
              {signal.notes
                .split(" | ")
                .filter((n) => n.trim() && !n.includes("==="))
                .slice(0, 6)
                .map((line, i) => (
                  <div
                    key={i}
                    className="text-[11px] font-mono text-muted-foreground bg-muted/40 rounded-sm px-3 py-1.5 leading-relaxed"
                  >
                    {line.trim()}
                  </div>
                ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Entry Metrics */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold uppercase text-muted-foreground">
              Entry Price
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold font-mono">{formatNumber(signal.entryPrice)}</div>
            <p className="text-xs text-muted-foreground font-mono mt-1">{signal.timeframe} TF</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold uppercase text-muted-foreground flex items-center gap-1">
              <Shield className="h-3 w-3" /> Stop Loss
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold font-mono text-destructive">
              {formatNumber(signal.stopLoss)}
            </div>
            <p className="text-xs text-muted-foreground font-mono mt-1">{riskPct}% risk</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold uppercase text-muted-foreground flex items-center gap-1">
              <Target className="h-3 w-3" /> Take Profit
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold font-mono text-primary">
              {formatNumber(signal.takeProfit)}
            </div>
            <p className="text-xs text-muted-foreground font-mono mt-1">{rewardPct}% reward</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold uppercase text-muted-foreground">
              Risk / Reward
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className={cn("text-xl font-bold font-mono", rrColor)}>
              1:{rr.toFixed(2)}
            </div>
            <p className="text-xs text-muted-foreground font-mono mt-1">{rrLabel}</p>
          </CardContent>
        </Card>
      </div>

      {/* Confidence Score Breakdown */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold uppercase text-muted-foreground flex items-center gap-2">
            <BarChart3 className="h-4 w-4" /> Confidence Score Breakdown
          </CardTitle>
        </CardHeader>
        <CardContent>
          {/* Total bar */}
          <div className="flex items-center gap-4 mb-6">
            <div className="text-4xl font-bold font-mono">{signal.confidence}%</div>
            <div className="flex-1">
              <div className="h-3 bg-secondary rounded-full overflow-hidden">
                <div
                  className={cn(
                    "h-full rounded-full transition-all",
                    signal.confidence > 70
                      ? "bg-primary"
                      : signal.confidence > 50
                      ? "bg-yellow-500"
                      : "bg-destructive"
                  )}
                  style={{ width: `${signal.confidence}%` }}
                />
              </div>
              <div className="text-xs text-muted-foreground font-mono mt-1">
                {signal.confidence > 70
                  ? "HIGH CONFIDENCE"
                  : signal.confidence > 50
                  ? "MEDIUM CONFIDENCE"
                  : "LOW CONFIDENCE"}
              </div>
            </div>
          </div>

          {/* Score rows */}
          <div className="grid gap-2 sm:grid-cols-2">
            {scoreRows.map((row) => (
              <div
                key={row.label}
                className={cn(
                  "flex items-center justify-between p-2.5 rounded-sm border text-xs font-mono",
                  row.active
                    ? "border-primary/40 bg-primary/10 text-foreground"
                    : "border-border/40 bg-muted/20 text-muted-foreground opacity-50"
                )}
              >
                <div className="flex flex-col gap-0.5">
                  <span className="font-semibold">{row.label}</span>
                  <span className="text-[10px] opacity-70">{row.description}</span>
                </div>
                <span
                  className={cn(
                    "font-bold text-sm ml-3 flex-shrink-0",
                    row.active ? "text-primary" : ""
                  )}
                >
                  +{row.pts}
                </span>
              </div>
            ))}
          </div>

          <p className="text-[10px] font-mono text-muted-foreground mt-3">
            * Scores shown are maximum possible per factor. Actual total may include a −15 penalty
            if H4 trend conflicts with HTF direction (normal during pullbacks).
          </p>
        </CardContent>
      </Card>

      {/* HTF Order Flow & Entry Analysis from stored notes */}
      {parsedNotes &&
        (parsedNotes.htfFlow.length > 0 || parsedNotes.entryAnalysis.length > 0) && (
          <div className="grid gap-4 md:grid-cols-2">
            {parsedNotes.htfFlow.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold uppercase text-muted-foreground flex items-center gap-2">
                    <TrendingUp className="h-4 w-4" /> HTF Order Flow
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {parsedNotes.htfFlow.map((line, i) => (
                    <div
                      key={i}
                      className="text-[11px] font-mono text-muted-foreground bg-muted/30 rounded-sm px-3 py-2 leading-relaxed"
                    >
                      {line}
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {parsedNotes.entryAnalysis.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold uppercase text-muted-foreground flex items-center gap-2">
                    <BarChart3 className="h-4 w-4" /> Entry Analysis
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {parsedNotes.entryAnalysis.map((line, i) => (
                    <div
                      key={i}
                      className="text-[11px] font-mono text-muted-foreground bg-muted/30 rounded-sm px-3 py-2 leading-relaxed"
                    >
                      {line}
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </div>
        )}

      {/* H4 conflict warning if it appears in notes */}
      {signal.notes?.includes("counter-trend") && (
        <Card className="border-yellow-500/30 bg-yellow-500/5">
          <CardContent className="flex items-start gap-3 p-4">
            <AlertTriangle className="h-4 w-4 text-yellow-500 flex-shrink-0 mt-0.5" />
            <p className="text-xs font-mono text-muted-foreground leading-relaxed">
              <span className="text-yellow-500 font-bold">H4 COUNTER-TREND DETECTED</span> — The H4
              timeframe was opposing the HTF direction when this signal was generated. This is a
              normal occurrence during higher-timeframe pullbacks, but confidence was reduced by 15
              points. The HTF majority still supported the trade direction.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
