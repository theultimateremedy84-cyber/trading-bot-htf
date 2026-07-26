import { Router, type IRouter } from "express";
import healthRouter from "./health";
import botRouter from "./bot";
import accountRouter from "./account";
import marketsRouter from "./markets";
import positionsRouter from "./positions";
import signalsRouter from "./signals";
import tradesRouter from "./trades";
import performanceRouter from "./performance";
import settingsRouter from "./settings";

const router: IRouter = Router();

router.use(healthRouter);
router.use(botRouter);
router.use(accountRouter);
router.use(marketsRouter);
router.use(positionsRouter);
router.use(signalsRouter);
router.use(tradesRouter);
router.use(performanceRouter);
router.use(settingsRouter);

export default router;
