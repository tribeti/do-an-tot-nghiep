import type { RequestHandler } from "express";
import { getAlerts } from "../services/alerts.service";

export const listAlerts: RequestHandler = async (req, res) => {
    const statusRaw = typeof req.query.status === "string" ? req.query.status : undefined;
    const limitRaw = typeof req.query.limit === "string" ? req.query.limit : undefined;
    const limit = limitRaw ? Number(limitRaw) : 100;

    if (statusRaw && statusRaw !== "active" && statusRaw !== "resolved") {
        res.status(400).json({ success: false, message: "status must be active or resolved." });
        return;
    }

    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
        res.status(400).json({ success: false, message: "limit must be an integer from 1 to 500." });
        return;
    }

    try {
        const alerts = await getAlerts({
            status: statusRaw as "active" | "resolved" | undefined,
            limit
        });

        res.json({ success: true, count: alerts.length, data: alerts });
    } catch (error) {
        console.error("Failed to get alerts:", error);
        res.status(500).json({ success: false, message: "Could not retrieve alerts." });
    }
};
