import { z } from "zod";

// One POST request represents one ESP32 sample collected every 10 seconds.
// A sample missing any sensor value is rejected as junk data: the ESP32
// maps the 400 response to "Rejected" and drops the sample from its queue,
// so incomplete readings never reach the database or the dashboard.
const particulateValue = z.number().finite().min(0).max(5000);
const temperatureValue = z.number().finite().min(-40).max(85);

export const readingSchema = z.object({
    measured_at: z.string().datetime({ offset: true }).optional(),

    pm1_0: particulateValue,
    pm2_5: particulateValue,
    pm10: particulateValue,

    // MH-Z19B variants support configured measuring ranges up to 10,000 ppm.
    co2: z.number().int().min(0).max(10000),

    // DHT22 temperature and relative humidity.
    temperature: temperatureValue,
    humidity: z.number().finite().min(0).max(100),
}).strict();

export type ReadingInput = z.infer<typeof readingSchema>;
