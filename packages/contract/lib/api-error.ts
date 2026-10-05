import { z } from "zod";

/** What the worker's API answers with when a request fails. */
export const ApiError = z.object({ error: z.string() });
export type ApiError = z.infer<typeof ApiError>;
