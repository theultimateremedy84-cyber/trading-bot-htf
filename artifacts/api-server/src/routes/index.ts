import { Router, type IRouter } from "express";
import healthRouter from "./health";
import botRouter from "./bot";
import positionsRouter from "./positions";
import tradesRouter from "./trades";
import signalsRouter from "./signals";
import marketsRouter from "./markets";
import performanceRouter from "./performance";
import settingsRouter from "./settings";
import accountRouter from "./account";

const router: IRouter = Router();

router.use(healthRouter);
router.use(botRouter);
router.use(positionsRouter);
router.use(tradesRouter);
router.use(signalsRouter);
router.use(marketsRouter);
router.use(performanceRouter);
router.use(settingsRouter);
router.use(accountRouter);

export default router;
