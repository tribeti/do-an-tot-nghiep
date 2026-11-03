import type { RequestHandler } from "express";
import { readingSchema } from "../validators/readings.validator";
import {
    getLatestReading,
    getReadingHistory,
    getWindowAverage,
    insertReading
} from "../services/readings.service";
import { evaluateAlerts } from "../services/alerts.service";

export const createReading: RequestHandler = async (req, res) => {
    const parsed = readingSchema.safeParse(req.body);

    if (!parsed.success) {
        res.status(400).json({
            success: false,
            message: "Invalid sensor reading.",
            errors: parsed.error.issues
        });
        return;
    }

    try {
        const reading = await insertReading(parsed.data);

        // Evaluate 8-hour and 24-hour averages after every received sample.
        // A temporary alert-processing failure does not undo the saved reading.
        let alertEvaluation: "completed" | "failed" = "completed";
        try {
            await evaluateAlerts();
        } catch (error) {
            alertEvaluation = "failed";
            console.error("Alert evaluation failed:", error);
        }

        res.status(201).json({
            success: true,
            message: "Sensor reading saved successfully.",
            data: reading,
            alert_evaluation: alertEvaluation
        });
    } catch (error) {
        console.error("Failed to save sensor reading:", error);
        res.status(500).json({
            success: false,
            message: "Could not save sensor reading."
        });
    }
};

export const getLatest: RequestHandler = async (_req, res) => {
    try {
        const reading = await getLatestReading();
        res.json({ success: true, data: reading });
    } catch (error) {
        console.error("Failed to get latest reading:", error);
        res.status(500).json({ success: false, message: "Could not retrieve latest reading." });
    }
};

export const getHistory: RequestHandler = async (req, res) => {
    const fromRaw = typeof req.query.from === "string" ? req.query.from : undefined;
    const toRaw = typeof req.query.to === "string" ? req.query.to : undefined;
    const limitRaw = typeof req.query.limit === "string" ? req.query.limit : undefined;

    const from = fromRaw ? new Date(fromRaw) : new Date(Date.now() - 24 * 60 * 60 * 1000);
    const to = toRaw ? new Date(toRaw) : new Date();
    const limit = limitRaw ? Number(limitRaw) : 10000;

    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from > to) {
        res.status(400).json({ success: false, message: "Invalid from/to datetime range." });
        return;
    }

    if (!Number.isInteger(limit) || limit < 1 || limit > 20000) {
        res.status(400).json({ success: false, message: "limit must be an integer from 1 to 20000." });
        return;
    }

    try {
        const readings = await getReadingHistory({ from, to, limit });
        res.json({
            success: true,
            count: readings.length,
            from: from.toISOString(),
            to: to.toISOString(),
            data: readings
        });
    } catch (error) {
        console.error("Failed to get reading history:", error);
        res.status(500).json({ success: false, message: "Could not retrieve reading history." });
    }
};

export const getAverages: RequestHandler = async (req, res) => {
    const windowRaw = typeof req.query.window === "string" ? req.query.window : undefined;

    if (windowRaw && windowRaw !== "8" && windowRaw !== "24") {
        res.status(400).json({ success: false, message: "window must be 8 or 24 hours." });
        return;
    }

    try {
        if (windowRaw) {
            const data = await getWindowAverage(Number(windowRaw) as 8 | 24);
            res.json({ success: true, data });
            return;
        }

        const [eightHours, twentyFourHours] = await Promise.all([
            getWindowAverage(8),
            getWindowAverage(24)
        ]);

        res.json({ success: true, data: { eight_hours: eightHours, twenty_four_hours: twentyFourHours } });
    } catch (error) {
        console.error("Failed to calculate averages:", error);
        res.status(500).json({ success: false, message: "Could not calculate sensor averages." });
    }
};
