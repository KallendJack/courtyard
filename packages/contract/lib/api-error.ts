// In Zod's small edition (zod/mini), as every page, the first one too, checks it (#393).
import { z } from "zod/mini";

/** What the worker's API answers with when a request fails. */
export const ApiError = z.object({ error: z.string() });
export type ApiError = z.infer<typeof ApiError>;
