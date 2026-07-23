import { Link, useLocation } from "wouter";
import { 
  Activity, 
  BarChart2, 
  Target, 
  Settings, 
  Power, 
  Radio,
  ListOrdered,
  AlertCircle
} from "lucide-react";
import { useGetBotStatus, useStartBot, useStopBot } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import { useToast } from "@/hooks/use-toast";

const links = [
  { href: "/", label: "Dashboard", icon: Activity },
  { href: "/markets", label: "Markets", icon: Radio },
  { href: "/signals", label: "Signals", icon: Target },
  { href: "/trades", label: "Trades", icon: ListOrdered },
  { href: "/performance", label: "Performance", icon: BarChart2 },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { data: status } = useGetBotStatus({ query: { refetchInterval: 5000 } });
  const { toast } = useToast();
  const startBot = useStartBot({
    mutation: {
      onError: (err: unknown) => {
        const msg =
          (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
          (err instanceof Error ? err.message : "Failed to start bot");
        toast({ title: "Cannot start bot", description: msg, variant: "destructive" });
      },
    },
  });
  const stopBot = useStopBot({
    mutation: {
      onError: () => {
        toast({ title: "Failed to stop bot", variant: "destructive" });
      },
    },
  });

  const isRunning = status?.running;

  return (
    <div className="flex min-h-[100dvh] w-full bg-background text-foreground selection:bg-primary/30">
      {/* Sidebar */}
      <aside className="fixed inset-y-0 left-0 z-10 hidden w-60 flex-col border-r border-border bg-sidebar md:flex">
        <div className="flex h-14 items-center border-b border-border px-6">
          <div className="flex items-center gap-2 font-mono font-bold tracking-tight">
            <div className="flex h-6 w-6 items-center justify-center rounded-sm bg-primary text-primary-foreground">
              <Activity className="h-4 w-4" />
            </div>
            ICT_BOT_V1
          </div>
        </div>
        
        <div className="flex-1 overflow-auto py-4">
          <nav className="grid gap-1 px-4">
            {links.map((link) => (
              <Link 
                key={link.href} 
                href={link.href}
                className={cn(
                  "flex items-center gap-3 rounded-sm px-3 py-2 text-sm font-medium transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  location === link.href ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-muted-foreground"
                )}
              >
                <link.icon className="h-4 w-4" />
                {link.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="border-t border-border p-4">
          <div className="mb-4 rounded-sm border border-border bg-card p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase text-muted-foreground">System Power</span>
              <div className="flex items-center gap-1.5">
                <span className={cn(
                  "h-2 w-2 rounded-full",
                  isRunning ? "bg-primary shadow-[0_0_8px_rgba(34,197,94,0.6)] animate-pulse" : "bg-destructive"
                )} />
                <span className="font-mono text-xs text-muted-foreground">
                  {isRunning ? 'ONLINE' : 'OFFLINE'}
                </span>
              </div>
            </div>
            {isRunning ? (
              <Button 
                variant="destructive" 
                size="sm" 
                className="w-full h-8 font-mono text-xs font-bold"
                onClick={() => stopBot.mutate()}
                disabled={stopBot.isPending}
              >
                <Power className="mr-2 h-3 w-3" />
                HALT SYSTEM
              </Button>
            ) : (
              <Button 
                variant="default" 
                size="sm" 
                className="w-full h-8 font-mono text-xs font-bold"
                onClick={() => startBot.mutate()}
                disabled={startBot.isPending}
              >
                <Power className="mr-2 h-3 w-3" />
                INITIALIZE
              </Button>
            )}
            
            {status?.uptime != null && isRunning && (
              <div className="mt-3 flex justify-between font-mono text-[10px] text-muted-foreground">
                <span>UPTIME</span>
                <span>{Math.floor(status.uptime / 3600)}h {Math.floor((status.uptime % 3600) / 60)}m</span>
              </div>
            )}

            {!isRunning && status?.error && (
              <div className="mt-3 flex items-start gap-1.5 rounded-sm bg-destructive/10 border border-destructive/20 px-2 py-2">
                <AlertCircle className="h-3 w-3 text-destructive shrink-0 mt-0.5" />
                <p className="font-mono text-[10px] text-destructive leading-relaxed break-words">
                  {status.error}
                </p>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex flex-1 flex-col md:pl-60">
        <div className="flex-1 p-6 md:p-8">
          <div className="mx-auto max-w-6xl">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
