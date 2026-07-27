import { useGetTrades } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatCurrencySigned, formatNumber, formatDateShort, cnProfitLoss, cn } from "@/lib/utils";

export default function Trades() {
  const { data: trades } = useGetTrades({ limit: 100 });

  if (!trades) return <div className="p-8 text-center font-mono text-muted-foreground">LOADING_TRADES...</div>;

  return (
    <div className="min-w-0 space-y-5 sm:space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight font-sans sm:text-2xl">Trade History</h1>
        <p className="mt-1 text-xs text-muted-foreground font-mono">Complete log of executed trades</p>
      </div>

      <Card className="min-w-0 border-border">
        <CardContent className="overflow-x-auto p-0">
          <Table className="min-w-[920px]">
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead>Date</TableHead>
                <TableHead>Market</TableHead>
                <TableHead>Dir</TableHead>
                <TableHead>Entry</TableHead>
                <TableHead>Stop Loss</TableHead>
                <TableHead>Take Profit</TableHead>
                <TableHead>Exit</TableHead>
                <TableHead>Strategy</TableHead>
                <TableHead className="text-right">R:R</TableHead>
                <TableHead className="text-right">P&L</TableHead>
                <TableHead className="text-right">Result</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {trades.map((trade) => (
                <TableRow key={trade.id}>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{formatDateShort(trade.entryDate)}</TableCell>
                  <TableCell className="whitespace-nowrap font-bold text-foreground">{trade.market}</TableCell>
                  <TableCell>
                    <span className={cn("text-[10px] font-bold", trade.direction === "BUY" ? "text-primary" : "text-destructive")}>
                      {trade.direction}
                    </span>
                  </TableCell>
                  <TableCell>{formatNumber(trade.entryPrice)}</TableCell>
                  <TableCell className="font-mono text-xs text-destructive">{trade.stopLoss != null ? formatNumber(trade.stopLoss) : "-"}</TableCell>
                  <TableCell className="font-mono text-xs text-primary">{trade.takeProfit != null ? formatNumber(trade.takeProfit) : "-"}</TableCell>
                  <TableCell>{trade.exitPrice ? formatNumber(trade.exitPrice) : "-"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{trade.strategy}</TableCell>
                  <TableCell className="text-right text-muted-foreground">{trade.riskRewardRatio ? `1:${trade.riskRewardRatio.toFixed(1)}` : "-"}</TableCell>
                  <TableCell className={cn("text-right font-bold", cnProfitLoss(trade.profit))}>{trade.profit != null ? formatCurrencySigned(trade.profit) : "-"}</TableCell>
                  <TableCell className="text-right">
                    {trade.result ? (
                      <Badge variant={trade.result === "WIN" ? "default" : trade.result === "LOSS" ? "destructive" : "outline"} className="h-5 px-1.5 text-[9px]">
                        {trade.result}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="h-5 px-1.5 border-blue-400/30 text-[9px] text-blue-400">
                        OPEN
                      </Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}