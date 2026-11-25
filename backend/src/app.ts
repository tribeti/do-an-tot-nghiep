// ============================================================
//  Backend giám sát chất lượng không khí
//  ------------------------------------------------------------
//  Một request đi qua đúng 4 lớp (mỗi thư mục một lớp):
//    server.ts      : đọc .env, kiểm tra PostgreSQL, mở port, tắt gọn
//    app.ts (file này): ghép middleware, mount routes, phục vụ dashboard
//    routes/        : khai báo URL -> controller (1 dòng mỗi endpoint)
//    controllers/   : kiểm tra query/body, gọi service, trả JSON + mã lỗi
//    validators/    : schema zod chặn mẫu đo thiếu/null trước khi chạm SQL
//    services/      : toàn bộ SQL (đọc/ghi PostgreSQL, trung bình, cảnh báo)
//  Thêm endpoint mới: khai báo ở routes/, viết handler ở controllers/,
//  đặt SQL ở services/. Không viết SQL trong controller.
// ============================================================

import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import path from "node:path";
import readingsRoutes from "./routes/readings.routes";
import alertsRoutes from "./routes/alerts.routes";
import { pool } from "./config/database";

const app = express();
const publicDirectory = path.resolve(__dirname, "../../frontend");

app.use(cors({ origin: process.env.CORS_ORIGIN ?? "*" }));
app.use(express.json({ limit: "64kb" }));

app.get("/health", async (_req, res) => {
    try {
        await pool.query("SELECT 1");
        res.json({ success: true, status: "ok", database: "connected" });
    } catch (error) {
        console.error("Health check failed:", error);
        res.status(503).json({ success: false, status: "unavailable", database: "disconnected" });
    }
});

app.get("/api", (_req, res) => {
    res.json({
        name: "Indoor Air Quality API",
        status: "running",
        endpoints: [
            "GET /health",
            "POST /api/readings",
            "GET /api/readings/latest",
            "GET /api/readings/history",
            "GET /api/readings/averages",
            "GET /api/alerts"
        ]
    });
});

app.use("/api/readings", readingsRoutes);
app.use("/api/alerts", alertsRoutes);

// The dashboard is served by the same Express server. ESP32 and browser use
// the same backend host/port; no separate frontend server or CORS setup needed.
app.use(express.static(publicDirectory, { etag: true, maxAge: 0 }));

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
