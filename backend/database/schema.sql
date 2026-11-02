CREATE TABLE sensor_readings (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    device_id VARCHAR(50) NOT NULL DEFAULT 'esp32-01',

    measured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    pm1_0 REAL CHECK (pm1_0 >= 0),
    pm2_5 REAL CHECK (pm2_5 >= 0),
    pm10 REAL CHECK (pm10 >= 0),

    co2 INTEGER CHECK (co2 >= 0),

    temperature DOUBLE PRECISION,
    humidity DOUBLE PRECISION CHECK (humidity BETWEEN 0 AND 100),

    bmp_temperature DOUBLE PRECISION,
    pressure DOUBLE PRECISION
);

CREATE INDEX idx_readings_measured_at
ON sensor_readings (measured_at DESC);

CREATE INDEX idx_readings_device_time
ON sensor_readings (device_id, measured_at DESC);


CREATE TABLE alerts (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    parameter VARCHAR(30) NOT NULL,
    window_hours SMALLINT NOT NULL
        CHECK (window_hours IN (8, 24)),

    average_value DOUBLE PRECISION NOT NULL,
    threshold_value DOUBLE PRECISION NOT NULL,

    window_start TIMESTAMPTZ NOT NULL,
    window_end TIMESTAMPTZ NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (parameter, window_hours, window_start, window_end)
);