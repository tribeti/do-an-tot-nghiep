import { z } from "zod";

// One request represents one sensor collection cycle (10 seconds).
// Missing/unavailable sensor values may be sent as null.
export const readingSchema = z.object({
    measured_at: z.string().datetime({ offset: true }).optional(),

    pm1_0: z.number().finite().min(0).nullable().optional(),
    pm2_5: z.number().finite().min(0).nullable().optional(),
    pm10: z.number().finite().min(0).nullable().optional(),

    co2: z.number().int().min(0).nullable().optional(),
    temperature: z.number().finite().min(-40).max(85).nullable().optional(),
    humidity: z.number().finite().min(0).max(100).nullable().optional(),
    pressure: z.number().finite().positive().nullable().optional()
}).strict().refine(
    (value) => [
        value.pm1_0,
        value.pm2_5,
        value.pm10,
        value.co2,
        value.temperature,
        value.humidity,
        value.pressure
    ].some((item) => item !== undefined && item !== null),
    { message: "At least one sensor value must be provided." }
);

export type ReadingInput = z.infer<typeof readingSchema>;
