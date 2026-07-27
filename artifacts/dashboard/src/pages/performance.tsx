import { useGetPerformance, useGetTrades } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrencySigned, formatPercentage, formatNumber, cnProfitLoss, formatDateShort } from "@/lib/utils";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { useMemo } from "react";

export default function Performance() {
  const { data: performance, error: perfError } = useGetPerformance({ query: { refetchInterval: 30000 } });
  const { data: trades } = useGetTrades({ limit: 100 });

  const chartData = useMemo(() => {
    if (!trades) return [];
    let cumulative = 0;
    const sorted = [...trades].sort((a, b) => new Date(a.entryDate).getTime() - new Date(b.entryDate).getTime());
    return sorted.filter((t) => t.profit != null).map((t) => {
      cumulative += t.profit!;
      return { date: formatDateShort(t.exitDate || t.entryDate), pnl: cumulative, tradePnl: t.profit };
    });
  }, [trades]);

  if (perfError) {
    return (
      <div className="space-y-2 p-4 text-center font-mono text-destructive sm:p-8">
        <div className="text-lg font-bold">PERFORMANCE_FETCH_ERROR</div>
        <div className="mx-auto max-w-lg break-all text-xs text-muted-foreground">{perfError.message}</div>
        <div className="mt-4 text-xs text-muted-foreground">Check that the API server is running and DATABASE_URL is set.</div>
      </div>
    );
  }

  if (!performance) return <div className="p-8 text-center font-mono text-muted-foreground">LOADING_PERFORMANCE...</div>;

  return (
    <div className="min-w-0 space-y-5 sm:space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight font-sans sm:text-2xl">Performance</h1>
        <p className="mt-1 text-xs text-muted-foreground font-mono">System analytics and equity curve</p>
      </div>

      <div className="grid gap-3 sm:gap-4 md:grid-cols-4">
        <Card><CardContent className="p-4"><div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Total Net P&L</div><div className={`text-2xl font-bold font-mono ${cnProfitLoss(performance.totalPnl)}`}>{formatCurrencySigned(performance.totalPnl)}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Win Rate</div><div className="text-2xl font-bold font-mono">{formatPercentage(performance.winRate)}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Avg R:R</div><div className="text-2xl font-bold font-mono">1:{formatNumber(performance.avgRR, 1)}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Max Drawdown</div><div className="text-2xl font-bold font-mono text-destructive">{formatCurrencySigned(-performance.maxDrawdown)}</div></CardContent></Card>
      </div>

      <Card className="border-border">
        <CardHeader><CardTitle className="text-sm font-semibold uppercase text-muted-foreground">Equity Curve</CardTitle></CardHeader>
        <CardContent>
          <div className="h-[240px] w-full sm:h-[300px]">
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 5, right: 0, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                  <XAxis dataKey="date" stroke="#a1a1aa" fontSize={10} tickLine={false} axisLine={false} minTickGap={30} />
                  <YAxis stroke="#a1a1aa" fontSize={10} tickLine={false} axisLine={false} tickFormatter={(val) => `$${val}`} />
                  <Tooltip contentStyle={{ backgroundColor: "#18181b", border: "1px solid #27272a", borderRadius: "4px", fontSize: "12px", fontFamily: "monospace" }} itemStyle={{ color: "#e4e4e7" }} />
                  <Line type="stepAfter" dataKey="pnl" stroke="#22c55e" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: "#22c55e", stroke: "#18181b" }} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center rounded-sm border border-dashed border-border font-mono text-sm text-muted-foreground">INSUFFICIENT_DATA</div>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="min-w-0 border-border">
          <CardHeader><CardTitle className="text-sm font-semibold uppercase text-muted-foreground">Market Breakdown</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <Table className="min-w-[420px]">
              <TableHeader><TableRow><TableHead>Market</TableHead><TableHead className="text-right">Trades</TableHead><TableHead className="text-right">Win%</TableHead><TableHead className="text-right">P&L</TableHead></TableRow></TableHeader>
              <TableBody>
                {performance.byMarket.map((m) => (
                  <TableRow key={m.epic}><TableCell className="font-bold">{m.market}</TableCell><TableCell className="text-right">{m.trades}</TableCell><TableCell className="text-right">{formatPercentage(m.winRate)}</TableCell><TableCell className={`text-right font-bold ${cnProfitLoss(m.pnl)}`}>{formatCurrencySigned(m.pnl)}</TableCell></TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardHeader><CardTitle className="text-sm font-semibold uppercase text-muted-foreground">Trade Stats</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-4 font-mono text-sm">
              <div className="flex items-center justify-between border-b border-border/50 pb-2"><span className="text-muted-foreground">Best Trade</span><span className="font-bold text-primary">{formatCurrencySigned(performance.bestTrade)}</span></div>
              <div className="flex items-center justify-between border-b border-border/50 pb-2"><span className="text-muted-foreground">Worst Trade</span><span className="font-bold text-destructive">{formatCurrencySigned(performance.worstTrade)}</span></div>
              <div className="flex items-center justify-between border-b border-border/50 pb-2"><span className="text-muted-foreground">Consecutive Wins</span><span className="text-primary">{performance.consecutiveWins}</span></div>
              <div className="flex items-center justify-between border-b border-border/50 pb-2"><span className="text-muted-foreground">Consecutive Losses</span><span className="text-destructive">{performance.consecutiveLosses}</span></div>
              <div className="flex items-center justify-between pt-2"><span className="text-muted-foreground">Sharpe Ratio</span><span>{performance.sharpeRatio ? formatNumber(performance.sharpeRatio, 2) : "-"}</span></div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}