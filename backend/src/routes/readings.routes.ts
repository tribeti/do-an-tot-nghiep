import { Router } from "express";
import {
    createReading,
    getAverages,
    getHistory,
    getLatest
} from "../controllers/readings.controller";

const router = Router();

router.post("/", createReading);
router.get("/latest", getLatest);
router.get("/history", getHistory);
router.get("/averages", getAverages);

export default router;
