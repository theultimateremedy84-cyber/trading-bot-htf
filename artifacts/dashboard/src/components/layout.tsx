import { Link, useLocation } from "wouter";
import {
  Activity,
  BarChart2,
  Target,
  Settings,
  Power,
  Radio,
  ListOrdered,
} from "lucide-react";
import { useGetBotStatus, useStartBot, useStopBot } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";

const links = [
  { href: "/", label: "Dashboard", icon: Activity },
  { href: "/markets", label: "Markets", icon: Radio },
  { href: "/signals", label: "Signals", icon: Target },
  { href: "/trades", label: "Trades", icon: ListOrdered },
  { href: "/performance", label: "Performance", icon: BarChart2 },
  { href: "/settings", label: "Settings", icon: Settings },
];

function BotControl({
  isRunning,
  status,
  startBot,
  stopBot,
}: {
  isRunning: boolean | undefined;
  status: { uptime?: number | null } | undefined;
  startBot: ReturnType<typeof useStartBot>;
  stopBot: ReturnType<typeof useStopBot>;
}) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={cn(
          "h-2 w-2 rounded-full",
          isRunning
            ? "animate-pulse bg-primary shadow-[0_0_8px_rgba(34,197,94,0.6)]"
            : "bg-destructive",
        )}
        aria-hidden="true"
      />
      <span className="hidden font-mono text-[10px] text-muted-foreground min-[380px]:inline">
        {isRunning ? "ONLINE" : "OFFLINE"}
      </span>
      {isRunning ? (
        <Button
          variant="destructive"
          size="sm"
          className="h-8 px-2 font-mono text-[10px] font-bold"
          onClick={() => stopBot.mutate()}
          disabled={stopBot.isPending}
          aria-label="Halt trading system"
        >
          <Power className="h-3 w-3 min-[380px]:mr-1.5" />
          <span className="hidden min-[380px]:inline">HALT</span>
        </Button>
      ) : (
        <Button
          variant="default"
          size="sm"
          className="h-8 px-2 font-mono text-[10px] font-bold"
          onClick={() => startBot.mutate()}
          disabled={startBot.isPending}
          aria-label="Start trading system"
        >
          <Power className="h-3 w-3 min-[380px]:mr-1.5" />
          <span className="hidden min-[380px]:inline">START</span>
        </Button>
      )}
      {status?.uptime != null && isRunning && (
        <span className="hidden font-mono text-[10px] text-muted-foreground lg:inline">
          {Math.floor(status.uptime / 3600)}h{" "}
          {Math.floor((status.uptime % 3600) / 60)}m
        </span>
      )}
    </div>
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { data: status } = useGetBotStatus({ query: { refetchInterval: 5000 } });
  const startBot = useStartBot();
  const stopBot = useStopBot();
  const isRunning = status?.running;

  return (
    <div className="flex min-h-[100dvh] w-full min-w-0 overflow-x-hidden bg-background text-foreground selection:bg-primary/30">
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
                  location === link.href
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-muted-foreground",
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
              <span className="text-xs font-semibold uppercase text-muted-foreground">
                System Power
              </span>
              <div className="flex items-center gap-1.5">
                <span
                  className={cn(
                    "h-2 w-2 rounded-full",
                    isRunning
                      ? "animate-pulse bg-primary shadow-[0_0_8px_rgba(34,197,94,0.6)]"
                      : "bg-destructive",
                  )}
                />
                <span className="font-mono text-xs text-muted-foreground">
                  {isRunning ? "ONLINE" : "OFFLINE"}
                </span>
              </div>
            </div>
            {isRunning ? (
              <Button
                variant="destructive"
                size="sm"
                className="h-8 w-full font-mono text-xs font-bold"
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
                className="h-8 w-full font-mono text-xs font-bold"
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
                <span>
                  {Math.floor(status.uptime / 3600)}h{" "}
                  {Math.floor((status.uptime % 3600) / 60)}m
                </span>
              </div>
            )}
          </div>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col md:pl-60">
        <header className="sticky top-0 z-20 border-b border-border bg-background/95 px-4 py-3 backdrop-blur md:hidden">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2 font-mono text-xs font-bold tracking-tight">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm bg-primary text-primary-foreground">
                <Activity className="h-4 w-4" />
              </div>
              <span className="truncate">ICT_BOT_V1</span>
            </div>
            <BotControl
              isRunning={isRunning}
              status={status}
              startBot={startBot}
              stopBot={stopBot}
            />
          </div>
          <nav
            className="-mx-1 mt-3 flex gap-1 overflow-x-auto pb-0.5"
            aria-label="Mobile navigation"
          >
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 rounded-sm px-2.5 py-1.5 text-[11px] font-medium transition-colors",
                  location === link.href
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <link.icon className="h-3.5 w-3.5" />
                {link.label}
              </Link>
            ))}
          </nav>
        </header>

        <div className="min-w-0 flex-1 px-4 py-5 sm:p-6 md:p-8">
          <div className="mx-auto min-w-0 max-w-6xl">{children}</div>
        </div>
      </main>
    </div>
  );
}