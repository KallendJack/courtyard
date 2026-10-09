import { type ApiError, ATTACHMENTS_FIELD, MESSAGE_FIELD } from "@courtyard/contract";
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

/**
 * A request's JSON, parsed with `schema`, and the files sent with it: JSON on its own, or a
 * multipart form with the JSON in the `fields.json` field and the files in `fields.files`. Or the
 * first reason it doesn't fit. A Thing from the owner's form with its photo comes this way (ADR 0020).
 */
export const readWithFiles = async <T>(
  c: Context,
  read: { schema: z.ZodType<T>; fields: { json: string; files: string } },
): Promise<Result<{ body: T; files: File[] }, string>> => {
  const { schema, fields } = read;
  if (!c.req.header("content-type")?.startsWith("multipart/form-data")) {
    const body = await readBody(c, schema);
    return body.ok ? ok({ body: body.value, files: [] }) : body;
  }
  const form = await c.req.formData().catch(() => undefined);
  const json = form?.get(fields.json);
  let body: unknown;
  try {
    body = typeof json === "string" ? JSON.parse(json) : undefined;
  } catch {
    body = undefined;
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Bad request");
  const files = (form?.getAll(fields.files) ?? []).filter((part) => part instanceof File);
  return ok({ body: parsed.data, files });
};

/**
 * A message the owner sent, parsed with `schema`, and the files attached to it (#78): JSON on its
 * own, or a multipart form with the JSON in one field and the files in another. Or the first reason
 * it doesn't fit.
 */
export const readMessage = async <T>(
  c: Context,
  schema: z.ZodType<T>,
): Promise<Result<{ message: T; files: File[] }, string>> => {
  const fields = { json: MESSAGE_FIELD, files: ATTACHMENTS_FIELD };
  const read = await readWithFiles(c, { schema, fields });
  return read.ok ? ok({ message: read.value.body, files: read.value.files }) : read;
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
