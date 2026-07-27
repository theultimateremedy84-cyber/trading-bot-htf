import { useGetAccount, useGetPositions, useGetSignals, useGetBotStatus, useClosePosition, useGetPerformance } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatCurrencySigned, formatNumber, formatPercentage, cnProfitLoss, formatDateShort, cn } from "@/lib/utils";
import { XCircle, Activity, DollarSign, PieChart, Clock } from "lucide-react";
import { toast } from "@/hooks/use-toast";

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
        onSuccess: () => {
          toast({ title: "Position closing requested", description: `Deal ID: ${dealId}` });
        },
        onError: () => {
          toast({ title: "Failed to close position", variant: "destructive" });
        }
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
      <div className="grid gap-4 md:grid-cols-4">
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
              Max Allowed: {status?.openPositions || 0}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold uppercase text-muted-foreground">Win Rate</CardTitle>
            <TargetIcon className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono">
              {performance ? formatPercentage(performance.winRate * 100) : '-'}
            </div>
            <p className="text-xs text-muted-foreground font-mono mt-1">
              Total Trades: {performance?.totalTrades || 0}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-7">
        {/* Open Positions */}
        <Card className="md:col-span-5 border-border">
          <CardHeader>
            <CardTitle className="text-sm font-semibold uppercase text-muted-foreground">Live Positions</CardTitle>
          </CardHeader>
          <CardContent>
            {positions && positions.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Market</TableHead>
                    <TableHead>Dir</TableHead>
                    <TableHead>Size</TableHead>
                    <TableHead>Open</TableHead>
                    <TableHead>Current</TableHead>
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
                      <TableCell>{pos.size}</TableCell>
                      <TableCell>{formatNumber(pos.openLevel)}</TableCell>
                      <TableCell>{formatNumber(pos.currentBid)}</TableCell>
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
            ) : (
              <div className="flex h-32 items-center justify-center text-sm font-mono text-muted-foreground border border-dashed border-border rounded-sm">
                NO_OPEN_POSITIONS
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Signals */}
        <Card className="md:col-span-2 border-border">
          <CardHeader>
            <CardTitle className="text-sm font-semibold uppercase text-muted-foreground">Recent Signals</CardTitle>
          </CardHeader>
          <CardContent className="px-2">
            <div className="space-y-1">
              {signals?.map(signal => (
                <div key={signal.id} className="flex flex-col gap-1 p-2 hover:bg-muted/30 rounded-sm transition-colors border-b border-border/50 last:border-0">
                  <div className="flex justify-between items-center">
                    <span className="font-mono font-bold text-xs">{signal.market}</span>
                    <Badge variant={signal.direction === 'BUY' ? 'default' : 'destructive'} className="text-[9px] px-1 py-0 h-4">
                      {signal.direction}
                    </Badge>
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

function TargetIcon(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" />
    </svg>
  )
}
