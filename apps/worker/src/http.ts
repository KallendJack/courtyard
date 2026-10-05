import type { ApiError } from "@courtyard/contract";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/** An error answer in the contract's shape: `{ error }` with a status. */
export const apiError = (c: Context, problem: { status: ContentfulStatusCode; error: string }) =>
  c.json({ error: problem.error } satisfies ApiError, problem.status);
