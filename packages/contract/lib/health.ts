// In Zod's small edition (zod/mini), as the home page checks it on the first load (#393).
import { z } from "zod/mini";

/** The worker's health check. Says it is up and nothing else about the machine. */
export const Health = z.object({ status: z.literal("ok") });
export type Health = z.infer<typeof Health>;
