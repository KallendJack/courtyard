import { randomUUID } from "node:crypto";
import { link, readFile, rename, rm, writeFile } from "node:fs/promises";
import type { z } from "zod";
import { err, ok, type Result } from "./result.ts";

/** Whether a filesystem error has this code, such as `ENOENT`. */
export const hasCode = (error: unknown, code: string) =>
  error instanceof Error && "code" in error && error.code === code;

/** A JSON file's contents, checked with `schema`; `undefined` when the file doesn't exist. */
export const readJsonFile = async <T>(
  path: string,
  schema: z.ZodType<T>,
): Promise<Result<T | undefined, "unreadable">> => {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    return hasCode(error, "ENOENT") ? ok(undefined) : err("unreadable");
  }
  try {
    const parsed = schema.safeParse(JSON.parse(text));
    return parsed.success ? ok(parsed.data) : err("unreadable");
  } catch {
    return err("unreadable");
  }
};

/**
 * Writes JSON readable only by the worker's user. It goes to a temporary file first, so a crash
 * mid-write never leaves half a file. With `exclusive`, it fails with `exists` rather than
 * replacing a file that's already there.
 */
export const writeJsonFile = async (
  path: string,
  value: unknown,
  options: { exclusive?: boolean } = {},
): Promise<Result<null, "exists" | "unwritable">> => {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
    // A hard link fails if the target exists, which makes the exclusive case one atomic step.
    if (options.exclusive) await link(temporary, path);
    else await rename(temporary, path);
    return ok(null);
  } catch (error) {
    return err(hasCode(error, "EEXIST") ? "exists" : "unwritable");
  } finally {
    if (options.exclusive) await rm(temporary, { force: true });
  }
};
