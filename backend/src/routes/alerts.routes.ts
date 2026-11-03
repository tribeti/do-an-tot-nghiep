import { Router } from "express";
import { listAlerts } from "../controllers/alerts.controller";

const router = Router();
router.get("/", listAlerts);

export default router;
