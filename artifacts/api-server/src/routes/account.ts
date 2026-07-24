import { Router, type IRouter } from "express";
import { getBotClient } from "../lib/botRunner";

const router: IRouter = Router();

router.get("/account", async (req, res) => {
  try {
    const client = getBotClient();
    if (!client) {
      return res.json({
        accountId: "--",
        accountName: "Bot Offline",
        balance: 0,
        deposit: 0,
        profitLoss: 0,
        available: 0,
        currency: "USD",
        status: "OFFLINE",
      });
    }

    const accounts = await client.getAccounts();
    const account = accounts[0];

    if (!account) {
      return res.status(404).json({ error: "No account found" });
    }

    res.json({
      accountId: account.accountId,
      accountName: account.accountName,
      balance: account.balance.balance,
      deposit: account.balance.deposit,
      profitLoss: account.balance.profitLoss,
      available: account.balance.available,
      currency: account.currency,
      status: account.status,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get account");
    res.status(500).json({ error: "Failed to get account info" });
  }
});

export default router;
