import { useGetPerformance, useGetTrades } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrencySigned, formatPercentage, formatNumber, cnProfitLoss, formatDateShort } from "@/lib/utils";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { useMemo } from "react";

export default function Performance() {
  const { data: performance } = useGetPerformance({ query: { refetchInterval: 30000 } });
  const { data: trades } = useGetTrades({ limit: 100 });

  const chartData = useMemo(() => {
    if (!trades) return [];
    let cumulative = 0;
    // Sort oldest first for cumulative
    const sorted = [...trades].sort((a, b) => new Date(a.entryDate).getTime() - new Date(b.entryDate).getTime());
    
    return sorted.filter(t => t.profit != null).map(t => {
      cumulative += t.profit!;
      return {
        date: formatDateShort(t.exitDate || t.entryDate),
        pnl: cumulative,
        tradePnl: t.profit
      };
    });
  }, [trades]);

  if (!performance) return <div className="p-8 text-center font-mono text-muted-foreground">LOADING_PERFORMANCE...</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight font-sans">Performance</h1>
        <p className="text-muted-foreground font-mono text-xs mt-1">System analytics and equity curve</p>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <div className="text-xs uppercase text-muted-foreground font-semibold mb-1">Total Net P&L</div>
            <div className={`text-2xl font-bold font-mono ${cnProfitLoss(performance.totalPnl)}`}>
              {formatCurrencySigned(performance.totalPnl)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs uppercase text-muted-foreground font-semibold mb-1">Win Rate</div>
            <div className="text-2xl font-bold font-mono">
              {formatPercentage(performance.winRate * 100)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs uppercase text-muted-foreground font-semibold mb-1">Avg R:R</div>
            <div className="text-2xl font-bold font-mono">
              1:{formatNumber(performance.avgRR, 1)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs uppercase text-muted-foreground font-semibold mb-1">Max Drawdown</div>
            <div className="text-2xl font-bold font-mono text-destructive">
              {formatPercentage(performance.maxDrawdown * 100)}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-border">
        <CardHeader>
          <CardTitle className="text-sm font-semibold uppercase text-muted-foreground">Equity Curve</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[300px] w-full">
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 5, right: 0, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                  <XAxis 
                    dataKey="date" 
                    stroke="#a1a1aa" 
                    fontSize={10} 
                    tickLine={false} 
                    axisLine={false}
                    minTickGap={30}
                  />
                  <YAxis 
                    stroke="#a1a1aa" 
                    fontSize={10} 
                    tickLine={false} 
                    axisLine={false} 
                    tickFormatter={(val) => `$${val}`}
                  />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#18181b', border: '1px solid #27272a', borderRadius: '4px', fontSize: '12px', fontFamily: 'monospace' }}
                    itemStyle={{ color: '#e4e4e7' }}
                  />
                  <Line 
                    type="stepAfter" 
                    dataKey="pnl" 
                    stroke="#22c55e" 
                    strokeWidth={2} 
                    dot={false}
                    activeDot={{ r: 4, fill: '#22c55e', stroke: '#18181b' }}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-muted-foreground font-mono text-sm border border-dashed border-border rounded-sm">
                INSUFFICIENT_DATA
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="border-border">
          <CardHeader>
            <CardTitle className="text-sm font-semibold uppercase text-muted-foreground">Market Breakdown</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Market</TableHead>
                  <TableHead className="text-right">Trades</TableHead>
                  <TableHead className="text-right">Win%</TableHead>
                  <TableHead className="text-right">P&L</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {performance.byMarket.map((m) => (
                  <TableRow key={m.epic}>
                    <TableCell className="font-bold">{m.market}</TableCell>
                    <TableCell className="text-right">{m.trades}</TableCell>
                    <TableCell className="text-right">{formatPercentage(m.winRate * 100)}</TableCell>
                    <TableCell className={`text-right font-bold ${cnProfitLoss(m.pnl)}`}>
                      {formatCurrencySigned(m.pnl)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardHeader>
            <CardTitle className="text-sm font-semibold uppercase text-muted-foreground">Trade Stats</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4 font-mono text-sm">
              <div className="flex justify-between items-center border-b border-border/50 pb-2">
                <span className="text-muted-foreground">Best Trade</span>
                <span className="text-primary font-bold">{formatCurrencySigned(performance.bestTrade)}</span>
              </div>
              <div className="flex justify-between items-center border-b border-border/50 pb-2">
                <span className="text-muted-foreground">Worst Trade</span>
                <span className="text-destructive font-bold">{formatCurrencySigned(performance.worstTrade)}</span>
              </div>
              <div className="flex justify-between items-center border-b border-border/50 pb-2">
                <span className="text-muted-foreground">Consecutive Wins</span>
                <span className="text-primary">{performance.consecutiveWins}</span>
              </div>
              <div className="flex justify-between items-center border-b border-border/50 pb-2">
                <span className="text-muted-foreground">Consecutive Losses</span>
                <span className="text-destructive">{performance.consecutiveLosses}</span>
              </div>
              <div className="flex justify-between items-center pt-2">
                <span className="text-muted-foreground">Sharpe Ratio</span>
                <span>{performance.sharpeRatio ? formatNumber(performance.sharpeRatio, 2) : '-'}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
