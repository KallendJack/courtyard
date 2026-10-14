// In Zod's small edition (zod/mini), as the workspace page's address check reads it on the first
// load (#393).
import { z } from "zod/mini";

/** One change in the context folder's history, by its git commit. */
export const ChangeId = z
  .string()
  .check(z.regex(/^[0-9a-f]{40}$/))
  .brand<"ChangeId">();
export type ChangeId = z.infer<typeof ChangeId>;
