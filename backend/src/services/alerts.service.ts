import { pool } from "../config/database";
import { getWindowAverage } from "./readings.service";

const ALERT_RULES = [
    { parameter: "pm2_5", threshold: 50 },
    { parameter: "pm10", threshold: 100 },
    { parameter: "co2", threshold: 1000 }
] as const;

export async function evaluateAlerts(): Promise<void> {
    // 8-hour window: public buildings; 24-hour window: residential rooms.
    for (const windowHours of [8, 24] as const) {
        const summary = await getWindowAverage(windowHours);
        if (!summary.complete) continue;

        for (const rule of ALERT_RULES) {
            const averageValue = summary.averages[rule.parameter];
            if (averageValue === null) continue;

            if (averageValue > rule.threshold) {
                // The partial unique index guarantees one active alert per
                // parameter/window even if two requests arrive close together.
                await pool.query(
                    `INSERT INTO alerts (
                        parameter, window_hours, average_value, threshold_value,
                        window_start, window_end, status, updated_at
                    ) VALUES ($1, $2, $3, $4, $5, $6, 'active', NOW())
                    ON CONFLICT (parameter, window_hours) WHERE status = 'active'
                    DO UPDATE SET
                        average_value = EXCLUDED.average_value,
                        threshold_value = EXCLUDED.threshold_value,
                        window_start = EXCLUDED.window_start,
                        window_end = EXCLUDED.window_end,
                        updated_at = NOW()`,
                    [rule.parameter, windowHours, averageValue, rule.threshold, summary.window_start, summary.window_end]
                );
            } else {
                await pool.query(
                    `UPDATE alerts
                     SET average_value = $1,
                         threshold_value = $2,
                         window_start = $3,
                         window_end = $4,
                         status = 'resolved',
                         updated_at = NOW(),
                         resolved_at = NOW()
                     WHERE parameter = $5
                       AND window_hours = $6
                       AND status = 'active'`,
                    [averageValue, rule.threshold, summary.window_start, summary.window_end, rule.parameter, windowHours]
                );
            }
        }
    }
}

export interface AlertQueryOptions {
    status?: "active" | "resolved";
    limit: number;
}

export async function getAlerts(options: AlertQueryOptions) {
    if (options.status) {
        const result = await pool.query(
            `SELECT * FROM alerts
             WHERE status = $1
             ORDER BY created_at DESC
             LIMIT $2`,
            [options.status, options.limit]
        );
        return result.rows;
    }

    const result = await pool.query(
        `SELECT * FROM alerts
         ORDER BY created_at DESC
         LIMIT $1`,
        [options.limit]
    );
    return result.rows;
}
