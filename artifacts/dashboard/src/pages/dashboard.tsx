import { useGetAccount, useGetPositions, useGetSignals, useGetBotStatus, useClosePosition, useGetPerformance, useGetSettings, useUpdateSettings } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { formatCurrency, formatCurrencySigned, formatNumber, cnProfitLoss, formatDateShort, cn } from "@/lib/utils";
import { XCircle, Activity, DollarSign, PieChart, ChevronRight, Pencil, Check, X, ShieldAlert, Target } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { useState } from "react";

export default function Dashboard() {
  const { data: account } = useGetAccount({ query: { refetchInterval: 15000 } });
  const { data: positions } = useGetPositions({ query: { refetchInterval: 5000 } });
  const { data: signals } = useGetSignals({ limit: 5 }, { query: { refetchInterval: 15000 } });
  const { data: performance } = useGetPerformance({ query: { refetchInterval: 30000 } });
  const { data: status } = useGetBotStatus({ query: { refetchInterval: 5000 } });
  const { data: settings, refetch: refetchSettings } = useGetSettings({ query: { refetchInterval: 30000 } });

  const closePosition = useClosePosition();
  const updateSettings = useUpdateSettings();

  // Profit target inline edit
  const [editingTarget, setEditingTarget] = useState(false);
  const [targetInput, setTargetInput] = useState("");

  // Daily loss limit inline edit
  const [editingLoss, setEditingLoss] = useState(false);
  const [lossInput, setLossInput] = useState("");

  const handleClose = (dealId: string) => {
    closePosition.mutate(
      { dealId },
      {
        onSuccess: () => {
          toast({ title: "Position closing requested", description: `Deal ID: ${dealId}` });
        },
        onError: () => {
          toast({ title: "Failed to close position", variant: "destructive" });
        }
      }
    );
  };

  const todayPnl = performance?.todayPnl ?? 0;
  const profitTarget = settings?.dailyProfitTarget ?? 40;
  const profitEnabled = settings?.haltOnDailyProfit ?? true;
  const lossLimitPct = settings?.dailyLossLimit ?? 3;
  const accountBalance = account?.balance ?? 0;
  const dailyLossAmount = accountBalance > 0 ? (accountBalance * lossLimitPct) / 100 : 0;

  // Progress calculations
  const profitProgress = profitTarget > 0 ? Math.min(100, (todayPnl / profitTarget) * 100) : 0;
  const lossProgress = dailyLossAmount > 0 ? Math.min(100, (Math.abs(Math.min(0, todayPnl)) / dailyLossAmount) * 100) : 0;

  const profitTargetReached = profitEnabled && todayPnl >= profitTarget;
  const lossLimitReached = todayPnl < 0 && Math.abs(todayPnl) >= dailyLossAmount && dailyLossAmount > 0;

  const handleToggleProfit = (checked: boolean) => {
    updateSettings.mutate(
      { data: { haltOnDailyProfit: checked } },
      {
        onSuccess: () => {
          refetchSettings();
          toast({ title: checked ? "Profit target halt enabled" : "Profit target halt disabled" });
        },
        onError: () => toast({ title: "Failed to update setting", variant: "destructive" }),
      }
    );
  };

  const handleSaveProfitTarget = () => {
    const val = parseFloat(targetInput);
    if (isNaN(val) || val <= 0) {
      toast({ title: "Enter a valid positive amount", variant: "destructive" });
      return;
    }
    updateSettings.mutate(
      { data: { dailyProfitTarget: val } },
      {
        onSuccess: () => {
          refetchSettings();
          setEditingTarget(false);
          toast({ title: `Profit target set to $${val.toFixed(2)}` });
        },
        onError: () => toast({ title: "Failed to update setting", variant: "destructive" }),
      }
    );
  };

  const handleSaveLossLimit = () => {
    const val = parseFloat(lossInput);
    if (isNaN(val) || val <= 0 || val > 100) {
      toast({ title: "Enter a valid percentage (1–100)", variant: "destructive" });
      return;
    }
    updateSettings.mutate(
      { data: { dailyLossLimit: val } },
      {
        onSuccess: () => {
          refetchSettings();
          setEditingLoss(false);
          toast({ title: `Daily loss limit set to ${val}%` });
        },
        onError: () => toast({ title: "Failed to update setting", variant: "destructive" }),
      }
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight font-sans">Dashboard</h1>
        <p className="text-muted-foreground font-mono text-xs mt-1">
          Last scan: {status?.lastScan ? formatDateShort(status.lastScan) : '-'} | 
          Active Markets: {status?.activeMarkets || 0}
        </p>
      </div>

      {/* Top Stats */}
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold uppercase text-muted-foreground">Account Balance</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono">{formatCurrency(account?.balance)}</div>
            <p className="text-xs text-muted-foreground font-mono mt-1">
              Available: {formatCurrency(account?.available)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold uppercase text-muted-foreground">Today's P&L</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className={cn("text-2xl font-bold font-mono", cnProfitLoss(performance?.todayPnl))}>
              {formatCurrencySigned(performance?.todayPnl)}
            </div>
            <p className="text-xs text-muted-foreground font-mono mt-1">
              Total P&L: <span className={cnProfitLoss(performance?.totalPnl)}>{formatCurrencySigned(performance?.totalPnl)}</span>
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold uppercase text-muted-foreground">Open Positions</CardTitle>
            <PieChart className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono">{positions?.length || 0}</div>
            <p className="text-xs text-muted-foreground font-mono mt-1">
              Win rate: {performance?.winRate != null ? `${performance.winRate.toFixed(1)}%` : '—'}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* ── Bot Halt Controls ─────────────────────────────────────────── */}
      <div className="grid gap-4 grid-cols-1 md:grid-cols-2">

        {/* Daily Profit Target */}
        <Card className={cn("border", profitTargetReached ? "border-primary/60 bg-primary/5" : "border-border")}>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Target className="h-4 w-4 text-primary" />
                <CardTitle className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">
                  Daily Profit Target
                </CardTitle>
              </div>
              <Switch
                checked={profitEnabled}
                onCheckedChange={handleToggleProfit}
                disabled={updateSettings.isPending}
                className="data-[state=checked]:bg-primary"
              />
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-end justify-between">
              <div className={cn("text-2xl font-bold font-mono", cnProfitLoss(todayPnl))}>
                {formatCurrencySigned(todayPnl)}
              </div>
              <div className="text-right text-xs font-mono text-muted-foreground">
                / {formatCurrency(profitTarget)} target
              </div>
            </div>

            <Progress
              value={Math.max(0, profitProgress)}
              className="h-2"
            />

            <div className="flex items-center justify-between text-xs font-mono text-muted-foreground">
              <span>{profitProgress > 0 ? `${profitProgress.toFixed(1)}% of target` : '—'}</span>
              {profitTargetReached
                ? <span className="text-primary font-semibold">TARGET REACHED — BOT HALTED</span>
                : status?.running
                ? <span className="text-muted-foreground">Auto-close &amp; halt at {formatCurrency(profitTarget)}</span>
                : <span className="text-muted-foreground">Start bot to begin trading</span>
              }
            </div>

            <div className="flex items-center gap-2 pt-1">
              <span className="text-xs text-muted-foreground font-mono">Target:</span>
              {editingTarget ? (
                <div className="flex items-center gap-1 flex-1">
                  <span className="text-xs text-muted-foreground font-mono">$</span>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={targetInput}
                    onChange={(e) => setTargetInput(e.target.value)}
                    className="h-6 text-xs font-mono w-24 px-1"
                    autoFocus
                    onKeyDown={(e) => { if (e.key === "Enter") handleSaveProfitTarget(); if (e.key === "Escape") setEditingTarget(false); }}
                  />
                  <Button variant="ghost" size="icon" className="h-5 w-5" onClick={handleSaveProfitTarget}>
                    <Check className="h-3 w-3 text-primary" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => setEditingTarget(false)}>
                    <X className="h-3 w-3 text-muted-foreground" />
                  </Button>
                </div>
              ) : (
                <button
                  className="flex items-center gap-1 text-xs font-mono font-semibold hover:text-primary transition-colors border border-border hover:border-primary/50 rounded px-2 py-0.5"
                  onClick={() => { setTargetInput(profitTarget.toFixed(2)); setEditingTarget(true); }}
                  title="Click to edit profit target"
                >
                  {formatCurrency(profitTarget)}
                  <Pencil className="h-3 w-3 text-muted-foreground" />
                </button>
              )}
            </div>

            {profitEnabled && (
              <p className="text-[10px] font-mono text-muted-foreground/70 leading-relaxed">
                When session profit reaches {formatCurrency(profitTarget)}, all open trades will be closed instantly and the bot will go offline automatically.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Daily Loss Limit */}
        <Card className={cn("border", lossLimitReached ? "border-destructive/60 bg-destructive/5" : "border-border")}>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-destructive" />
                <CardTitle className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">
                  Daily Loss Limit
                </CardTitle>
              </div>
              <Badge
                variant={lossLimitReached ? "destructive" : "outline"}
                className="text-[10px] font-mono px-2"
              >
                {lossLimitReached ? "LIMIT HIT" : "ACTIVE"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-end justify-between">
              <div className={cn("text-2xl font-bold font-mono", todayPnl < 0 ? "text-destructive" : "text-muted-foreground")}>
                {todayPnl < 0 ? formatCurrencySigned(todayPnl) : "$0.00"}
              </div>
              <div className="text-right text-xs font-mono text-muted-foreground">
                / {formatCurrency(dailyLossAmount)} limit
              </div>
            </div>

            <Progress
              value={Math.max(0, lossProgress)}
              className={cn("h-2", lossProgress > 70 ? "[&>div]:bg-destructive" : lossProgress > 40 ? "[&>div]:bg-yellow-500" : "")}
            />

            <div className="flex items-center justify-between text-xs font-mono text-muted-foreground">
              <span>{lossProgress > 0 ? `${lossProgress.toFixed(1)}% of limit used` : '—'}</span>
              {lossLimitReached
                ? <span className="text-destructive font-semibold">BOT HALTED — LIMIT EXCEEDED</span>
                : <span>New trades blocked if limit hit</span>
              }
            </div>

            <div className="flex items-center gap-2 pt-1">
              <span className="text-xs text-muted-foreground font-mono">Limit:</span>
              {editingLoss ? (
                <div className="flex items-center gap-1 flex-1">
                  <Input
                    type="number"
                    step="0.1"
                    min="0.1"
                    max="100"
                    value={lossInput}
                    onChange={(e) => setLossInput(e.target.value)}
                    className="h-6 text-xs font-mono w-20 px-1"
                    autoFocus
                    onKeyDown={(e) => { if (e.key === "Enter") handleSaveLossLimit(); if (e.key === "Escape") setEditingLoss(false); }}
                  />
                  <span className="text-xs text-muted-foreground font-mono">%</span>
                  <Button variant="ghost" size="icon" className="h-5 w-5" onClick={handleSaveLossLimit}>
                    <Check className="h-3 w-3 text-primary" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => setEditingLoss(false)}>
                    <X className="h-3 w-3 text-muted-foreground" />
                  </Button>
                </div>
              ) : (
                <button
                  className="flex items-center gap-1 text-xs font-mono font-semibold hover:text-primary transition-colors border border-border hover:border-primary/50 rounded px-2 py-0.5"
                  onClick={() => { setLossInput(lossLimitPct.toFixed(1)); setEditingLoss(true); }}
                  title="Click to edit loss limit"
                >
                  {lossLimitPct}% of balance ({formatCurrency(dailyLossAmount)})
                  <Pencil className="h-3 w-3 text-muted-foreground" />
                </button>
              )}
            </div>

            <p className="text-[10px] font-mono text-muted-foreground/70 leading-relaxed">
              When today's losses exceed {formatCurrency(dailyLossAmount)} ({lossLimitPct}% of balance), the bot stops opening new positions for the rest of the day.
            </p>
          </CardContent>
        </Card>
      </div>
      {/* ───────────────────────────────────────────────────────────────── */}

      <div className="grid gap-4 md:grid-cols-7">
        {/* Open Positions */}
        <Card className="md:col-span-5 border-border">
          <CardHeader>
            <CardTitle className="text-sm font-semibold uppercase text-muted-foreground">Open Positions</CardTitle>
          </CardHeader>
          <CardContent>
            {positions && positions.length > 0 ? (
              <div className="overflow-x-auto -mx-2">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Market</TableHead>
                      <TableHead>Dir</TableHead>
                      <TableHead className="hidden sm:table-cell">Size</TableHead>
                      <TableHead className="hidden sm:table-cell">Value</TableHead>
                      <TableHead className="hidden sm:table-cell">Open</TableHead>
                      <TableHead className="hidden md:table-cell">Current</TableHead>
                      <TableHead>P&L</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {positions.map((pos) => (
                      <TableRow key={pos.dealId}>
                        <TableCell className="font-semibold text-foreground">{pos.market}</TableCell>
                        <TableCell>
                          <Badge variant={pos.direction === 'BUY' ? 'default' : 'destructive'} className="text-[10px]">
                            {pos.direction}
                          </Badge>
                        </TableCell>
                        <TableCell className="hidden sm:table-cell">{pos.size}</TableCell>
                        <TableCell className="hidden sm:table-cell font-mono text-xs text-muted-foreground">
                          {pos.notionalValue != null
                            ? `$${pos.notionalValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                            : '—'}
                        </TableCell>
                        <TableCell className="hidden sm:table-cell">{formatNumber(pos.openLevel)}</TableCell>
                        <TableCell className="hidden md:table-cell">{formatNumber(pos.currentBid)}</TableCell>
                        <TableCell className={cn("font-bold", cnProfitLoss(pos.profit))}>
                          {formatCurrencySigned(pos.profit)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-muted-foreground hover:text-destructive"
                            onClick={() => handleClose(pos.dealId)}
                          >
                            <XCircle className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="flex h-32 items-center justify-center text-sm font-mono text-muted-foreground border border-dashed border-border rounded-sm">
                NO_OPEN_POSITIONS
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Signals — clickable */}
        <Card className="md:col-span-2 border-border">
          <CardHeader>
            <CardTitle className="text-sm font-semibold uppercase text-muted-foreground">Recent Signals</CardTitle>
          </CardHeader>
          <CardContent className="px-2">
            <div className="space-y-1">
              {signals?.map(signal => (
                <Link key={signal.id} href={`/signals/${signal.id}`}>
                  <div className="flex flex-col gap-1 p-2 hover:bg-muted/40 active:bg-muted/60 rounded-sm transition-colors border-b border-border/50 last:border-0 cursor-pointer group">
                    <div className="flex justify-between items-center">
                      <span className="font-mono font-bold text-xs group-hover:text-primary transition-colors">{signal.market}</span>
                      <div className="flex items-center gap-1">
                        <Badge variant={signal.direction === 'BUY' ? 'default' : 'destructive'} className="text-[9px] px-1 py-0 h-4">
                          {signal.direction}
                        </Badge>
                        <ChevronRight className="h-3 w-3 text-muted-foreground/50 group-hover:text-muted-foreground transition-colors" />
                      </div>
                    </div>
                    <div className="flex justify-between items-center text-[10px] font-mono text-muted-foreground">
                      <span>{signal.signalType.replace(/_/g, ' ')}</span>
                      <span className="text-foreground">{formatNumber(signal.entryPrice)}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <div className="h-1 flex-1 bg-secondary rounded-full overflow-hidden">
                        <div
                          className={cn(
                            "h-full",
                            signal.confidence > 70 ? "bg-primary" : signal.confidence > 50 ? "bg-yellow-500" : "bg-destructive"
                          )}
                          style={{ width: `${signal.confidence}%` }}
                        />
                      </div>
                      <span className="text-[9px] font-mono text-muted-foreground w-6 text-right">
                        {signal.confidence}%
                      </span>
                    </div>
                  </div>
                </Link>
              ))}
              {!signals?.length && (
                <div className="text-center py-8 text-xs font-mono text-muted-foreground">
                  WAITING_FOR_SIGNALS...
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
