import { useGetTrades } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatCurrencySigned, formatNumber, formatDateShort, cnProfitLoss, cn } from "@/lib/utils";

export default function Trades() {
  const { data: trades } = useGetTrades({ limit: 100 });

  if (!trades) return <div className="p-8 text-center font-mono text-muted-foreground">LOADING_TRADES...</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight font-sans">Trade History</h1>
        <p className="text-muted-foreground font-mono text-xs mt-1">Complete log of executed trades</p>
      </div>

      <Card className="border-border">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead>Date</TableHead>
                <TableHead>Market</TableHead>
                <TableHead>Dir</TableHead>
                <TableHead>Entry</TableHead>
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
                  <TableCell className="text-muted-foreground">
                    {formatDateShort(trade.entryDate)}
                  </TableCell>
                  <TableCell className="font-bold text-foreground">{trade.market}</TableCell>
                  <TableCell>
                    <span className={cn(
                      "text-[10px] font-bold", 
                      trade.direction === 'BUY' ? 'text-primary' : 'text-destructive'
                    )}>
                      {trade.direction}
                    </span>
                  </TableCell>
                  <TableCell>{formatNumber(trade.entryPrice)}</TableCell>
                  <TableCell>{trade.exitPrice ? formatNumber(trade.exitPrice) : '-'}</TableCell>
                  <TableCell className="text-muted-foreground text-xs">{trade.strategy}</TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {trade.riskRewardRatio ? `1:${trade.riskRewardRatio.toFixed(1)}` : '-'}
                  </TableCell>
                  <TableCell className={cn("text-right font-bold", cnProfitLoss(trade.profit))}>
                    {trade.profit != null ? formatCurrencySigned(trade.profit) : '-'}
                  </TableCell>
                  <TableCell className="text-right">
                    {trade.result ? (
                      <Badge variant={
                        trade.result === 'WIN' ? 'default' : 
                        trade.result === 'LOSS' ? 'destructive' : 'outline'
                      } className="text-[9px] h-5 px-1.5">
                        {trade.result}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[9px] h-5 px-1.5 text-blue-400 border-blue-400/30">
                        OPEN
                      </Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {trades.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="h-24 text-center text-muted-foreground">
                    NO_TRADES_FOUND
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
