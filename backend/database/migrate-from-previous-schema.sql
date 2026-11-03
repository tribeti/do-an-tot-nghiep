-- Run this only if you already created the earlier schema from the previous instructions.
-- It removes columns that are outside the approved one-device proposal design.

ALTER TABLE sensor_readings
    DROP COLUMN IF EXISTS device_id,
    DROP COLUMN IF EXISTS bmp_temperature;

ALTER TABLE alerts
    ADD COLUMN IF NOT EXISTS status VARCHAR(10) NOT NULL DEFAULT 'active',
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;

-- The previous table allowed multiple alerts for the same parameter/window.
-- Keep the newest one active and resolve older duplicates before adding the index.
WITH ranked_active_alerts AS (
    SELECT
        id,
        ROW_NUMBER() OVER (
            PARTITION BY parameter, window_hours
            ORDER BY created_at DESC, id DESC
        ) AS row_number
    FROM alerts
    WHERE status = 'active'
)
UPDATE alerts
SET status = 'resolved',
    resolved_at = NOW(),
    updated_at = NOW()
FROM ranked_active_alerts
WHERE alerts.id = ranked_active_alerts.id
  AND ranked_active_alerts.row_number > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_alerts_active_parameter_window
    ON alerts (parameter, window_hours)
    WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_alerts_created_at
    ON alerts (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_status_created_at
    ON alerts (status, created_at DESC);
