import { pool } from "../config/database";
import { getWindowAverage } from "./readings.service";

const ALERT_RULES = [
    { parameter: "pm2_5", threshold: 50 },
    { parameter: "pm10", threshold: 100 },
    { parameter: "co2", threshold: 1000 }
] as const;

type AlertParameter = typeof ALERT_RULES[number]["parameter"];

export async function evaluateAlerts(): Promise<void> {
    // The proposal requires both 8-hour (public spaces) and 24-hour (residential)
    // averages. Incomplete windows are not compared with the thresholds.
    for (const windowHours of [8, 24] as const) {
        const summary = await getWindowAverage(windowHours);
        if (!summary.complete) continue;

        const client = await pool.connect();
        try {
            await client.query("BEGIN");

            for (const rule of ALERT_RULES) {
                const parameter = rule.parameter as AlertParameter;
                const averageValue = summary.averages[parameter];
                if (averageValue === null) continue;

                const activeResult = await client.query(
                    `SELECT id
                     FROM alerts
                     WHERE parameter = $1
                       AND window_hours = $2
                       AND status = 'active'
                     LIMIT 1
                     FOR UPDATE`,
                    [parameter, windowHours]
                );

                const activeAlert = activeResult.rows[0];
                const exceeded = averageValue > rule.threshold;

                if (exceeded && activeAlert) {
                    await client.query(
                        `UPDATE alerts
                         SET average_value = $1,
                             threshold_value = $2,
                             window_start = $3,
                             window_end = $4,
                             updated_at = NOW()
                         WHERE id = $5`,
                        [averageValue, rule.threshold, summary.window_start, summary.window_end, activeAlert.id]
                    );
                } else if (exceeded) {
                    await client.query(
                        `INSERT INTO alerts (
                            parameter, window_hours, average_value, threshold_value,
                            window_start, window_end, status
                         ) VALUES ($1, $2, $3, $4, $5, $6, 'active')`,
                        [parameter, windowHours, averageValue, rule.threshold, summary.window_start, summary.window_end]
                    );
                } else if (activeAlert) {
                    await client.query(
                        `UPDATE alerts
                         SET average_value = $1,
                             threshold_value = $2,
                             window_start = $3,
                             window_end = $4,
                             status = 'resolved',
                             updated_at = NOW(),
                             resolved_at = NOW()
                         WHERE id = $5`,
                        [averageValue, rule.threshold, summary.window_start, summary.window_end, activeAlert.id]
                    );
                }
            }

            await client.query("COMMIT");
        } catch (error) {
            await client.query("ROLLBACK");
            throw error;
        } finally {
            client.release();
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
