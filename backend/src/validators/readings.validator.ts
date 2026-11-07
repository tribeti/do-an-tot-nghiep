import { z } from "zod";

// One POST request represents one ESP32 sample collected every 10 seconds.
// A sensor that is not ready may be represented as null.
const particulateValue = z.number().finite().min(0).max(5000).nullable().optional();
const temperatureValue = z.number().finite().min(-40).max(85).nullable().optional();

export const readingSchema = z.object({
    measured_at: z.string().datetime({ offset: true }).optional(),

    pm1_0: particulateValue,
    pm2_5: particulateValue,
    pm10: particulateValue,

    // MH-Z19B variants support configured measuring ranges up to 10,000 ppm.
    co2: z.number().int().min(0).max(10000).nullable().optional(),

    // DHT22 temperature and relative humidity.
    temperature: temperatureValue,
    humidity: z.number().finite().min(0).max(100).nullable().optional(),

}).strict().refine(
    (value) => [
        value.pm1_0,
        value.pm2_5,
        value.pm10,
        value.co2,
        value.temperature,
        value.humidity
    ].some((item) => item !== undefined && item !== null),
    { message: "At least one sensor value must be provided." }
);

export type ReadingInput = z.infer<typeof readingSchema>;
