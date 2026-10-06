import { randomUUID } from "node:crypto";
import { link, readFile, rename, rm, writeFile } from "node:fs/promises";
import { setTimeout as wait } from "node:timers/promises";
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
 * How long to wait before each new try at replacing a file Windows says is busy. It refuses for a
 * moment while something else has the file open (another request reading it, say, or a virus
 * scanner); about a second of patience covers it.
 */
const BUSY_RETRY_DELAYS_MS = [10, 20, 40, 80, 160, 320, 640];
/** The errors Windows gives for a busy file; elsewhere these mean a real permission problem. */
const BUSY_CODES = process.platform === "win32" ? ["EPERM", "EACCES", "EBUSY"] : [];

/**
 * Moves a file or folder to `to` (a file goes over any file already there), waiting out the
 * moments Windows says it's busy.
 */
export const move = async (from: string, to: string) => {
  for (const delay of [...BUSY_RETRY_DELAYS_MS, undefined]) {
    try {
      return await rename(from, to);
    } catch (error) {
      const busy = BUSY_CODES.some((code) => hasCode(error, code));
      if (!busy || delay === undefined) throw error;
      await wait(delay);
    }
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
    else await move(temporary, path);
    return ok(null);
  } catch (error) {
    return err(hasCode(error, "EEXIST") ? "exists" : "unwritable");
  } finally {
    // Gone already after a replace; left behind by a link or a failure. Cleaning up never fails
    // the write.
    await rm(temporary, { force: true }).catch(() => undefined);
  }
};
