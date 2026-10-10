import { Router, type IRouter } from "express";
import chainlensRouter from "./chainlens";
import healthRouter from "./health";

const router: IRouter = Router();

router.use(healthRouter);
router.use(chainlensRouter);

export default router;
