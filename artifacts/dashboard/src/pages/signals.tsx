import { useGetSignals } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatNumber, formatDateShort, cn } from "@/lib/utils";
import { Link } from "wouter";
import { ChevronRight } from "lucide-react";

export default function Signals() {
  const { data: signals } = useGetSignals({ limit: 100 }, { query: { refetchInterval: 10000 } });

  if (!signals) return <div className="p-8 text-center font-mono text-muted-foreground">LOADING_SIGNALS...</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight font-sans">ICT Signals Feed</h1>
        <p className="text-muted-foreground font-mono text-xs mt-1">
          Real-time detected order blocks, FVGs, and liquidity sweeps · Tap any signal for full details
        </p>
      </div>

      <div className="space-y-3">
        {signals.map((signal) => (
          <Link key={signal.id} href={`/signals/${signal.id}`}>
            <Card className="border-border hover:border-primary/50 active:border-primary transition-colors cursor-pointer group">
              <CardContent className="p-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  
                  <div className="flex items-center gap-4 min-w-[160px]">
                    <div className="flex flex-col gap-1">
                      <span className="font-mono font-bold text-lg group-hover:text-primary transition-colors">{signal.market}</span>
                      <span className="text-[10px] text-muted-foreground font-mono">{formatDateShort(signal.detectedAt)}</span>
                    </div>
                    <Badge variant={signal.direction === 'BUY' ? 'default' : 'destructive'} className="h-6">
                      {signal.direction}
                    </Badge>
                  </div>

                  <div className="flex-1 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm font-mono">
                    <div>
                      <div className="text-[10px] text-muted-foreground uppercase mb-1">Type</div>
                      <div className="text-xs">{signal.signalType.replace(/_/g, ' ')}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-muted-foreground uppercase mb-1">Entry</div>
                      <div>{formatNumber(signal.entryPrice)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-muted-foreground uppercase mb-1">Stop Loss</div>
                      <div className="text-destructive">{formatNumber(signal.stopLoss)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-muted-foreground uppercase mb-1">Take Profit</div>
                      <div className="text-primary">{formatNumber(signal.takeProfit)}</div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between sm:flex-col sm:items-end min-w-[120px] gap-2">
                    <div className="flex flex-wrap gap-1">
                      {signal.killZone && (
                        <Badge variant={
                          signal.killZone === 'LONDON' ? 'blue' : 
                          signal.killZone === 'NEW_YORK' ? 'orange' : 'purple'
                        } className="text-[10px]">
                          {signal.killZone} KZ
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2 sm:w-full sm:max-w-[100px]">
                      <div className="flex-1">
                        <div className="flex justify-between text-[10px] font-mono mb-1">
                          <span className="text-muted-foreground uppercase">Conf</span>
                          <span>{signal.confidence}%</span>
                        </div>
                        <div className="h-1.5 w-full bg-secondary rounded-full overflow-hidden">
                          <div 
                            className={cn(
                              "h-full", 
                              signal.confidence > 70 ? "bg-primary" : signal.confidence > 50 ? "bg-yellow-500" : "bg-destructive"
                            )} 
                            style={{ width: `${signal.confidence}%` }}
                          />
                        </div>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground/50 group-hover:text-muted-foreground flex-shrink-0 transition-colors" />
                    </div>
                  </div>

                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
        {signals.length === 0 && (
          <div className="text-center py-12 font-mono text-muted-foreground border border-dashed border-border rounded-sm">
            NO_SIGNALS_DETECTED
          </div>
        )}
      </div>
    </div>
  );
}
