import { useGetAccount, useGetPositions, useGetSignals, useGetBotStatus, useClosePosition, useGetPerformance } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatCurrencySigned, formatNumber, formatPercentage, cnProfitLoss, formatDateShort, cn } from "@/lib/utils";
import { XCircle, Activity, DollarSign, PieChart } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { Link } from "wouter";

export default function Dashboard() {
  const { data: account } = useGetAccount({ query: { refetchInterval: 15000 } });
  const { data: positions } = useGetPositions({ query: { refetchInterval: 10000 } });
  const { data: signals } = useGetSignals({ limit: 5 }, { query: { refetchInterval: 15000 } });
  const { data: performance } = useGetPerformance({ query: { refetchInterval: 30000 } });
  const { data: status } = useGetBotStatus({ query: { refetchInterval: 5000 } });
  const closePosition = useClosePosition();

  const handleClose = (dealId: string) => {
    closePosition.mutate(
      { dealId },
      {
        onSuccess: () => toast({ title: "Position closing requested", description: `Deal ID: ${dealId}` }),
        onError: () => toast({ title: "Failed to close position", variant: "destructive" }),
      },
    );
  };

  return (
    <div className="min-w-0 space-y-5 sm:space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight font-sans sm:text-2xl">Dashboard</h1>
        <p className="mt-1 text-xs text-muted-foreground font-mono">
          Last scan: {status?.lastScan ? formatDateShort(status.lastScan) : "-"} | Active Markets: {status?.activeMarkets || 0}
        </p>
      </div>

      <div className="grid gap-3 sm:gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold uppercase text-muted-foreground">Account Balance</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono">{formatCurrency(account?.balance)}</div>
            <p className="mt-1 text-xs text-muted-foreground font-mono">Available: {formatCurrency(account?.available)}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold uppercase text-muted-foreground">Today's P&L</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className={cn("text-2xl font-bold font-mono", cnProfitLoss(performance?.todayPnl))}>{formatCurrencySigned(performance?.todayPnl)}</div>
            <p className="mt-1 text-xs text-muted-foreground font-mono">
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
            <p className="mt-1 text-xs text-muted-foreground font-mono">Max Allowed: {status?.openPositions || 0}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold uppercase text-muted-foreground">Win Rate</CardTitle>
            <TargetIcon className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {/* FIX: performance.winRate is already a percentage (e.g. 65 = 65%).
                Previously it was multiplied by 100 again, producing values like
                6500%. The Performance page was always correct; only this card
                had the double-multiplication bug. */}
            <div className="text-2xl font-bold font-mono">{performance ? formatPercentage(performance.winRate) : "-"}</div>
            <p className="mt-1 text-xs text-muted-foreground font-mono">Total Trades: {performance?.totalTrades || 0}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid min-w-0 gap-4 md:grid-cols-7">
        <Card className="min-w-0 border-border md:col-span-5">
          <CardHeader><CardTitle className="text-sm font-semibold uppercase text-muted-foreground">Live Positions</CardTitle></CardHeader>
          <CardContent className="min-w-0">
            {positions && positions.length > 0 ? (
              <div className="overflow-x-auto">
                <Table className="min-w-[620px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Market</TableHead><TableHead>Dir</TableHead><TableHead>Size</TableHead><TableHead>Open</TableHead>
                      <TableHead>Current</TableHead><TableHead>P&L</TableHead><TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {positions.map((pos) => (
                      <TableRow key={pos.dealId}>
                        <TableCell className="whitespace-nowrap font-semibold text-foreground">{pos.market}</TableCell>
                        <TableCell><Badge variant={pos.direction === "BUY" ? "default" : "destructive"} className="text-[10px]">{pos.direction}</Badge></TableCell>
                        <TableCell>{pos.size}</TableCell>
                        <TableCell>{formatNumber(pos.openLevel)}</TableCell>
                        <TableCell>{formatNumber(pos.currentBid)}</TableCell>
                        <TableCell className={cn("font-bold", cnProfitLoss(pos.profit))}>{formatCurrencySigned(pos.profit)}</TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => handleClose(pos.dealId)} aria-label={`Close ${pos.market} position`}>
                            <XCircle className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="flex h-32 items-center justify-center rounded-sm border border-dashed border-border text-sm font-mono text-muted-foreground">NO_OPEN_POSITIONS</div>
            )}
          </CardContent>
        </Card>

        <Card className="min-w-0 border-border md:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm font-semibold uppercase text-muted-foreground">Recent Signals</CardTitle>
            <p className="text-[10px] font-mono text-muted-foreground">Click any signal to see the full analysis</p>
          </CardHeader>
          <CardContent className="px-2">
            <div className="space-y-1">
              {signals?.map((signal) => (
                <Link key={signal.id} href={`/signals/${signal.id}`}>
                  <div className="flex flex-col gap-1 rounded-sm border-b border-border/50 p-2 transition-colors last:border-0 hover:bg-muted/40 cursor-pointer">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs font-bold">{signal.market}</span>
                      <Badge variant={signal.direction === "BUY" ? "default" : "destructive"} className="h-4 px-1 text-[9px]">{signal.direction}</Badge>
                    </div>
                    <div className="flex items-center justify-between text-[10px] font-mono text-muted-foreground">
                      <span>{signal.signalType.replace(/_/g, " ")}</span><span className="text-foreground">{formatNumber(signal.entryPrice)}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <div className="h-1 flex-1 overflow-hidden rounded-full bg-secondary">
                        <div className={cn("h-full", signal.confidence > 70 ? "bg-primary" : signal.confidence > 50 ? "bg-yellow-500" : "bg-destructive")} style={{ width: `${signal.confidence}%` }} />
                      </div>
                      <span className="w-6 text-right font-mono text-[9px] text-muted-foreground">{signal.confidence}%</span>
                    </div>
                  </div>
                </Link>
              ))}
              {!signals?.length && <div className="py-8 text-center text-xs font-mono text-muted-foreground">WAITING_FOR_SIGNALS...</div>}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function TargetIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" />
    </svg>
  );
}
