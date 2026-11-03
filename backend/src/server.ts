import "dotenv/config";
import app from "./app";
import { pool } from "./config/database";

const PORT = Number(process.env.PORT ?? 3001);

async function startServer(): Promise<void> {
    if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
        throw new Error("PORT must be an integer between 1 and 65535.");
    }

    await pool.query("SELECT 1");
    console.log("PostgreSQL connected successfully.");

    const server = app.listen(PORT, "0.0.0.0", () => {
        console.log(`Air Quality Dashboard: http://localhost:${PORT}`);
        console.log(`API information:       http://localhost:${PORT}/api`);
        console.log(`LAN access:            http://<COMPUTER_LAN_IP>:${PORT}`);
    });

    server.on("error", (error: NodeJS.ErrnoException) => {
        if (error.code === "EADDRINUSE") {
            console.error(`Port ${PORT} is already in use. Stop the other process or change PORT in .env.`);
        } else {
            console.error("HTTP server error:", error);
        }
        void pool.end().finally(() => process.exit(1));
    });

    const shutdown = (signal: string) => {
        console.log(`${signal} received. Closing server...`);
        server.close(() => {
            void pool.end().then(() => process.exit(0));
        });
    };

    process.once("SIGINT", () => shutdown("SIGINT"));
    process.once("SIGTERM", () => shutdown("SIGTERM"));
}

startServer().catch(async (error: unknown) => {
    console.error("Failed to start backend:", error);
    await pool.end();
    process.exit(1);
});
