import { pool } from "../config/database";

// Instant alert rules: the NEWEST sample exceeding a threshold creates or
// updates one active alert per parameter; dropping back below ends it.
const ALERT_RULES = [
    { parameter: "pm2_5", threshold: 50 },
    { parameter: "pm10", threshold: 100 },
    { parameter: "co2", threshold: 1000 }
] as const;

export async function evaluateAlerts(): Promise<void> {
    const latestResult = await pool.query(
        `SELECT measured_at, pm2_5, pm10, co2
         FROM sensor_readings
         ORDER BY measured_at DESC, id DESC
         LIMIT 1`
    );

    const latest = latestResult.rows[0];
    if (!latest) return;

    for (const rule of ALERT_RULES) {
        const value = latest[rule.parameter];
        if (value === null) continue;

        if (Number(value) > rule.threshold) {
            // window_hours = 0 marks an instant alert; the partial unique
            // index keeps one active alert per parameter.
            await pool.query(
                `INSERT INTO alerts (
                    parameter, window_hours, average_value, threshold_value,
                    window_start, window_end, status, updated_at
                ) VALUES ($1, 0, $2, $3, $4, $4, 'active', NOW())
                ON CONFLICT (parameter, window_hours) WHERE status = 'active'
                DO UPDATE SET
                    average_value = EXCLUDED.average_value,
                    threshold_value = EXCLUDED.threshold_value,
                    window_start = EXCLUDED.window_start,
                    window_end = EXCLUDED.window_end,
                    updated_at = NOW()`,
                [rule.parameter, value, rule.threshold, latest.measured_at]
            );
        } else {
            await pool.query(
                `UPDATE alerts
                 SET average_value = $1,
                     threshold_value = $2,
                     status = 'resolved',
                     updated_at = NOW(),
                     resolved_at = NOW()
                 WHERE parameter = $3
                   AND status = 'active'`,
                [value, rule.threshold, rule.parameter]
            );
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
