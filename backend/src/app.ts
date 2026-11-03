import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import readingsRoutes from "./routes/readings.routes";
import alertsRoutes from "./routes/alerts.routes";
import { pool } from "./config/database";

const app = express();

app.use(cors({ origin: process.env.CORS_ORIGIN ?? "*" }));
app.use(express.json({ limit: "1mb" }));

app.get("/", (_req, res) => {
    res.json({
        name: "Indoor Air Quality API",
        status: "running",
        endpoints: {
            health: "GET /health",
            create_reading: "POST /api/readings",
            latest_reading: "GET /api/readings/latest",
            reading_history: "GET /api/readings/history",
            reading_averages: "GET /api/readings/averages",
            alerts: "GET /api/alerts"
        }
    });
});

app.get("/health", async (_req, res) => {
    try {
        await pool.query("SELECT 1");
        res.json({ success: true, status: "ok", database: "connected" });
    } catch (error) {
        console.error("Health check failed:", error);
        res.status(503).json({ success: false, status: "unavailable", database: "disconnected" });
    }
});

app.use("/api/readings", readingsRoutes);
app.use("/api/alerts", alertsRoutes);

app.use((_req, res) => {
    res.status(404).json({ success: false, message: "Route not found." });
});

const jsonErrorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error instanceof SyntaxError && "body" in error) {
        res.status(400).json({ success: false, message: "Invalid JSON body." });
        return;
    }

    if (error?.type === "entity.too.large") {
        res.status(413).json({ success: false, message: "Request body is too large." });
        return;
    }

    console.error("Unhandled request error:", error);
    res.status(500).json({ success: false, message: "Internal server error." });
};

app.use(jsonErrorHandler);

export default app;
