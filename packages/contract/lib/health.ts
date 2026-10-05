import { z } from "zod";

/** The worker's health check. Says it is up and nothing else about the machine. */
export const Health = z.object({ status: z.literal("ok") });
export type Health = z.infer<typeof Health>;
