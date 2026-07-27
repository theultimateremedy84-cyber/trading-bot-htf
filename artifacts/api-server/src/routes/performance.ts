import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { tradesTable } from "@workspace/db";
import { desc } from "drizzle-orm";

const router: IRouter = Router();

router.get("/performance", async (req, res) => {
  try {
    const trades = await db.select().from(tradesTable).orderBy(desc(tradesTable.entryDate));
    const closedTrades = trades.filter((t) => t.exitDate && t.profit !== null && t.result !== null);

    const now = new Date();
    const todayStart = new Date(now); todayStart.setUTCHours(0, 0, 0, 0);
    const weekStart = new Date(now); weekStart.setDate(now.getDate() - 7);
    const monthStart = new Date(now); monthStart.setDate(now.getDate() - 30);

    const wins = closedTrades.filter((t) => t.result === "WIN");

    const totalPnl = closedTrades.reduce((sum, t) => sum + (t.profit ?? 0), 0);
    const todayPnl = closedTrades
      .filter((t) => t.exitDate && new Date(t.exitDate) >= todayStart)
      .reduce((sum, t) => sum + (t.profit ?? 0), 0);
    const weekPnl = closedTrades
      .filter((t) => t.exitDate && new Date(t.exitDate) >= weekStart)
      .reduce((sum, t) => sum + (t.profit ?? 0), 0);
    const monthPnl = closedTrades
      .filter((t) => t.exitDate && new Date(t.exitDate) >= monthStart)
      .reduce((sum, t) => sum + (t.profit ?? 0), 0);

    const winRate = closedTrades.length > 0 ? (wins.length / closedTrades.length) * 100 : 0;
    const avgRR =
      closedTrades.length > 0
        ? closedTrades.reduce((sum, t) => sum + (t.riskRewardRatio ?? 0), 0) / closedTrades.length
        : 0;

    const profits = closedTrades.map((t) => t.profit ?? 0);
    const bestTrade = profits.length > 0 ? Math.max(...profits) : 0;
    const worstTrade = profits.length > 0 ? Math.min(...profits) : 0;

    // Max drawdown calculation
    let peak = 0;
    let runningPnl = 0;
    let maxDrawdown = 0;
    for (const trade of [...closedTrades].reverse()) {
      runningPnl += trade.profit ?? 0;
      if (runningPnl > peak) peak = runningPnl;
      const dd = peak - runningPnl;
      if (dd > maxDrawdown) maxDrawdown = dd;
    }

    // Consecutive wins/losses
    let consecutiveWins = 0;
    let consecutiveLosses = 0;
    let tempWins = 0;
    let tempLosses = 0;
    for (const t of closedTrades) {
      if (t.result === "WIN") {
        tempWins++;
        tempLosses = 0;
        if (tempWins > consecutiveWins) consecutiveWins = tempWins;
      } else if (t.result === "LOSS") {
        tempLosses++;
        tempWins = 0;
        if (tempLosses > consecutiveLosses) consecutiveLosses = tempLosses;
      }
    }

    // Sharpe ratio (simplified)
    let sharpeRatio: number | null = null;
    if (profits.length > 1) {
      const mean = totalPnl / profits.length;
      const variance = profits.reduce((s, p) => s + Math.pow(p - mean, 2), 0) / profits.length;
      const stdDev = Math.sqrt(variance);
      sharpeRatio = stdDev > 0 ? mean / stdDev : null;
    }

    // By market breakdown
    const epicMap: Record<string, { trades: number; wins: number; losses: number; pnl: number; market: string }> = {};
    for (const t of closedTrades) {
      if (!epicMap[t.epic]) {
        epicMap[t.epic] = { trades: 0, wins: 0, losses: 0, pnl: 0, market: t.market };
      }
      epicMap[t.epic].trades++;
      if (t.result === "WIN") epicMap[t.epic].wins++;
      if (t.result === "LOSS") epicMap[t.epic].losses++;
      epicMap[t.epic].pnl += t.profit ?? 0;
    }

    const byMarket = Object.entries(epicMap).map(([epic, data]) => ({
      epic,
      market: data.market,
      trades: data.trades,
      wins: data.wins,
      losses: data.losses,
      pnl: data.pnl,
      winRate: data.trades > 0 ? (data.wins / data.trades) * 100 : 0,
    }));

    res.json({
      totalTrades: closedTrades.length,
      winRate,
      totalPnl,
      todayPnl,
      weekPnl,
      monthPnl,
      avgRR,
      bestTrade,
      worstTrade,
      consecutiveWins,
      consecutiveLosses,
      sharpeRatio,
      maxDrawdown,
      byMarket,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get performance");
    res.status(500).json({ error: "Failed to get performance" });
  }
});

export default router;
