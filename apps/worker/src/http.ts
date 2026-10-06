import type { ApiError } from "@courtyard/contract";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { z } from "zod";
import { err, ok, type Result } from "./result.ts";

/** An error answer in the contract's shape: `{ error }` with a status. */
export const apiError = (c: Context, problem: { status: ContentfulStatusCode; error: string }) =>
  c.json({ error: problem.error } satisfies ApiError, problem.status);

/** The JSON body a request sent, parsed with `schema`, or the first reason it doesn't fit. */
export const readBody = async <T>(c: Context, schema: z.ZodType<T>): Promise<Result<T, string>> => {
  const parsed = schema.safeParse(await c.req.json().catch(() => undefined));
  return parsed.success ? ok(parsed.data) : err(parsed.error.issues[0]?.message ?? "Bad request");
};
