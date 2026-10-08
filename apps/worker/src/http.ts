import type { ApiError } from "@courtyard/contract";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { z } from "zod";
import { err, ok, type Result } from "./result.ts";
import type { WorkspaceError } from "./workspaces/index.ts";

/** An error answer in the contract's shape: `{ error }` with a status. */
export const apiError = (c: Context, problem: { status: ContentfulStatusCode; error: string }) =>
  c.json({ error: problem.error } satisfies ApiError, problem.status);

/** The JSON body a request sent, parsed with `schema`, or the first reason it doesn't fit. */
export const readBody = async <T>(c: Context, schema: z.ZodType<T>): Promise<Result<T, string>> => {
  const parsed = schema.safeParse(await c.req.json().catch(() => undefined));
  return parsed.success ? ok(parsed.data) : err(parsed.error.issues[0]?.message ?? "Bad request");
};

/** Why Get to know or Tidy, with no model named, found none to ask. */
export const NO_SAVING_MODEL =
  "No model that saves to context is available. Check the providers' settings.";

/** An error reading or changing the context folder, as an answer. */
export const contextError = (c: Context, error: WorkspaceError) => {
  switch (error.kind) {
    case "not-found":
      return apiError(c, { status: 404, error: "No such workspace" });
    case "archived":
      return apiError(c, {
        status: 410,
        error:
          "This workspace is archived. Move its folder out of the archived folder to bring it back.",
      });
    case "invalid":
      return apiError(c, { status: 400, error: error.message });
    case "conflict":
      return apiError(c, { status: 409, error: error.message });
    case "storage":
      return apiError(c, { status: 500, error: error.message });
  }
};
