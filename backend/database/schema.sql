-- Database schema for the indoor air-quality monitoring project.
-- One room and one device are in scope; there is intentionally no device_id.

CREATE TABLE IF NOT EXISTS sensor_readings (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    measured_at TIMESTAMPTZ NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    pm1_0 DOUBLE PRECISION CHECK (pm1_0 IS NULL OR pm1_0 >= 0),
    pm2_5 DOUBLE PRECISION CHECK (pm2_5 IS NULL OR pm2_5 >= 0),
    pm10 DOUBLE PRECISION CHECK (pm10 IS NULL OR pm10 >= 0),

    co2 INTEGER CHECK (co2 IS NULL OR co2 >= 0),
    temperature DOUBLE PRECISION CHECK (temperature IS NULL OR temperature BETWEEN -40 AND 85),
    humidity DOUBLE PRECISION CHECK (humidity IS NULL OR humidity BETWEEN 0 AND 100)
);

CREATE INDEX IF NOT EXISTS idx_sensor_readings_measured_at
    ON sensor_readings (measured_at DESC);

CREATE TABLE IF NOT EXISTS alerts (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    parameter VARCHAR(20) NOT NULL CHECK (parameter IN ('pm2_5', 'pm10', 'co2')),
    -- window_hours = 0: instant alert from the newest sample;
    -- 8 and 24: legacy average-window alerts kept for old rows.
    window_hours SMALLINT NOT NULL CHECK (window_hours IN (0, 8, 24)),
    average_value DOUBLE PRECISION NOT NULL,
    threshold_value DOUBLE PRECISION NOT NULL,
    window_start TIMESTAMPTZ NOT NULL,
    window_end TIMESTAMPTZ NOT NULL,
    status VARCHAR(10) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'resolved')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ
);

-- Prevent multiple simultaneously-active alerts for the same parameter and window.
CREATE UNIQUE INDEX IF NOT EXISTS uq_alerts_active_parameter_window
    ON alerts (parameter, window_hours)
    WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_alerts_created_at
    ON alerts (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_status_created_at
    ON alerts (status, created_at DESC);
