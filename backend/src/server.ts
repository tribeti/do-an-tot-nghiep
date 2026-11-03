import "dotenv/config";
import app from "./app";
import { pool } from "./config/database";

const PORT = Number(process.env.PORT ?? 3000);

async function startServer(): Promise<void> {
    try {
        await pool.query("SELECT 1");
        console.log("PostgreSQL connected successfully.");

        const server = app.listen(PORT, "0.0.0.0", () => {
            console.log(`Air Quality Backend running at http://localhost:${PORT}`);
            console.log(`LAN access: http://<COMPUTER_LAN_IP>:${PORT}`);
        });

        server.on("error", (error: NodeJS.ErrnoException) => {
            if (error.code === "EADDRINUSE") {
                console.error(`Port ${PORT} is already in use.`);
                console.error(`Stop the other process or change PORT in .env (for example PORT=3001).`);
            } else {
                console.error("HTTP server error:", error);
            }

            void pool.end().finally(() => process.exit(1));
        });

        const shutdown = (signal: string) => {
            console.log(`${signal} received. Closing server...`);
            server.close(() => {
                void pool.end().then(() => {
                    console.log("HTTP server and PostgreSQL pool closed.");
                    process.exit(0);
                });
            });
        };

        process.once("SIGINT", () => shutdown("SIGINT"));
        process.once("SIGTERM", () => shutdown("SIGTERM"));
    } catch (error) {
        console.error("Failed to start backend:", error);
        await pool.end();
        process.exit(1);
    }
}

void startServer();
