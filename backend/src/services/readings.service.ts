import { pool } from "../config/database";
import type { ReadingInput } from "../validators/readings.validator";

export interface WindowAverage {
    window_hours: 8 | 24;
    window_start: string;
    window_end: string;
    sample_count: number;
    first_measured_at: string | null;
    last_measured_at: string | null;
    complete: boolean;
    averages: {
        pm2_5: number | null;
        pm10: number | null;
        co2: number | null;
    };
}

export async function insertReading(reading: ReadingInput) {
    const result = await pool.query(
        `INSERT INTO sensor_readings (
            measured_at,
            pm1_0,
            pm2_5,
            pm10,
            co2,
            temperature,
            humidity
        ) VALUES (
            COALESCE($1::timestamptz, NOW()),
            $2, $3, $4, $5, $6, $7
        )
        RETURNING id, measured_at, received_at, pm1_0, pm2_5, pm10, co2, temperature, humidity`,
        [
            reading.measured_at ?? null,
            reading.pm1_0,
            reading.pm2_5,
            reading.pm10,
            reading.co2,
            reading.temperature,
            reading.humidity
        ]
    );

    return result.rows[0];
}

export async function getLatestReading() {
    const result = await pool.query(
        `SELECT id, measured_at, received_at, pm1_0, pm2_5, pm10, co2, temperature, humidity
         FROM sensor_readings
         ORDER BY measured_at DESC, id DESC
         LIMIT 1`
    );

    return result.rows[0] ?? null;
}

export interface HistoryOptions {
    from: Date;
    to: Date;
    limit: number;
}

export async function getReadingHistory(options: HistoryOptions) {
    const result = await pool.query(
        `SELECT * FROM (
            SELECT id, measured_at, received_at, pm1_0, pm2_5, pm10, co2, temperature, humidity
            FROM sensor_readings
            WHERE measured_at >= $1 AND measured_at <= $2
            ORDER BY measured_at DESC, id DESC
            LIMIT $3
         ) AS recent_readings
         ORDER BY measured_at ASC, id ASC`,
        [options.from, options.to, options.limit]
    );

    return result.rows;
}

function asNumber(value: string | number | null): number | null {
    if (value === null) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

export async function getWindowAverage(windowHours: 8 | 24): Promise<WindowAverage> {
    const result = await pool.query(
        `WITH bounds AS (
            SELECT
                NOW() AS window_end,
                NOW() - ($1::int * INTERVAL '1 hour') AS window_start
        )
        SELECT
            bounds.window_start,
            bounds.window_end,
            COUNT(readings.id)::int AS sample_count,
            MIN(readings.measured_at) AS first_measured_at,
            MAX(readings.measured_at) AS last_measured_at,
            AVG(readings.pm2_5) AS avg_pm2_5,
            AVG(readings.pm10) AS avg_pm10,
            AVG(readings.co2) AS avg_co2
        FROM bounds
        LEFT JOIN sensor_readings AS readings
            ON readings.measured_at >= bounds.window_start
            AND readings.measured_at <= bounds.window_end
        GROUP BY bounds.window_start, bounds.window_end`,
        [windowHours]
    );

    const row = result.rows[0];
    const start = new Date(row.window_start);
    const end = new Date(row.window_end);
    const first = row.first_measured_at ? new Date(row.first_measured_at) : null;
    const last = row.last_measured_at ? new Date(row.last_measured_at) : null;
    const sampleCount = Number(row.sample_count);

    // Do not compare a partial startup window with the full-window TCVN limits.
    // With 10-second collection, the first record should cover the start and the
    // newest record should be reasonably close to the end of the rolling window.
    const complete = Boolean(
        sampleCount > 0 &&
        first && last &&
        first.getTime() <= start.getTime() + 2 * 60 * 1000 &&
        last.getTime() >= end.getTime() - 5 * 60 * 1000
    );

    return {
        window_hours: windowHours,
        window_start: start.toISOString(),
        window_end: end.toISOString(),
        sample_count: sampleCount,
        first_measured_at: first?.toISOString() ?? null,
        last_measured_at: last?.toISOString() ?? null,
        complete,
        averages: {
            pm2_5: asNumber(row.avg_pm2_5),
            pm10: asNumber(row.avg_pm10),
            co2: asNumber(row.avg_co2)
        }
    };
}
