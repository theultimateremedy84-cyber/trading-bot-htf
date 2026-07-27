import { useGetMarkets } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatNumber, formatPercentage, cn } from "@/lib/utils";
import { ArrowUpRight, ArrowDownRight, Minus, Radio } from "lucide-react";

export default function Markets() {
  const { data: markets } = useGetMarkets({ query: { refetchInterval: 5000 } });

  if (!markets) return <div className="p-8 text-center font-mono text-muted-foreground">LOADING_MARKETS...</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight font-sans">Markets</h1>
        <p className="text-muted-foreground font-mono text-xs mt-1">Live market data from Capital.com</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {markets.map((market) => (
          <MarketCard key={market.epic} market={market} />
        ))}
      </div>
    </div>
  );
}

function MarketCard({ market }: { market: any }) {
  const isUp = market.changePercent > 0;
  const isDown = market.changePercent < 0;
  
  return (
    <Card className="relative overflow-hidden group hover:border-primary/50 transition-colors">
      <CardContent className="p-5">
        <div className="flex justify-between items-start mb-4">
          <div>
            <h3 className="font-bold text-lg font-mono">{market.name}</h3>
            <div className="flex items-center gap-2 mt-1">
              <span className={cn(
                "h-2 w-2 rounded-full",
                market.marketStatus === 'TRADEABLE' ? "bg-primary" : "bg-muted"
              )} />
              <span className="text-xs font-mono text-muted-foreground">{market.marketStatus}</span>
            </div>
          </div>
          {market.trend && (
            <Badge variant="outline" className={cn(
              "font-mono text-[10px] uppercase",
              market.trend === 'BULLISH' ? 'text-primary border-primary/30' : 
              market.trend === 'BEARISH' ? 'text-destructive border-destructive/30' : 
              'text-muted-foreground'
            )}>
              {market.trend}
            </Badge>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <div className="text-[10px] uppercase text-muted-foreground font-semibold mb-1">Bid</div>
            <div className="font-mono text-sm">{formatNumber(market.bid, market.bid > 100 ? 2 : 5)}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase text-muted-foreground font-semibold mb-1">Offer</div>
            <div className="font-mono text-sm">{formatNumber(market.offer, market.offer > 100 ? 2 : 5)}</div>
          </div>
        </div>

        <div className="flex justify-between items-end pt-4 border-t border-border/50">
          <div>
            <div className="text-[10px] uppercase text-muted-foreground font-semibold mb-1">Spread</div>
            <div className="font-mono text-xs">{formatNumber(market.spread, 1)} pts</div>
          </div>
          <div className="text-right">
            <div className={cn(
              "font-mono text-sm font-bold flex items-center justify-end gap-1",
              isUp ? "text-primary" : isDown ? "text-destructive" : "text-muted-foreground"
            )}>
              {isUp ? <ArrowUpRight className="h-3 w-3" /> : isDown ? <ArrowDownRight className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
              {formatPercentage(market.changePercent)}
            </div>
          </div>
        </div>

        {market.activeSignal && (
          <div className="absolute top-0 right-0 p-1">
             <div className="bg-primary/20 text-primary text-[9px] font-mono px-1.5 py-0.5 rounded-bl-sm flex items-center gap-1">
               <Radio className="h-2 w-2 animate-pulse" /> SIGNAL
             </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
