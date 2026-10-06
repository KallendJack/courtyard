import { randomUUID } from "node:crypto";
import { link, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { setTimeout as wait } from "node:timers/promises";
import type { z } from "zod";
import { err, ok, type Result } from "./result.ts";

/** Whether a filesystem error has this code, such as `ENOENT`. */
export const hasCode = (error: unknown, code: string) =>
  error instanceof Error && "code" in error && error.code === code;

/** A text file's contents; `undefined` when the file doesn't exist. */
export const readTextFile = async (
  path: string,
): Promise<Result<string | undefined, "unreadable">> => {
  try {
    return ok(await readFile(path, "utf8"));
  } catch (error) {
    return hasCode(error, "ENOENT") ? ok(undefined) : err("unreadable");
  }
};

/** A JSON file's contents, checked with `schema`; `undefined` when the file doesn't exist. */
export const readJsonFile = async <T>(
  path: string,
  schema: z.ZodType<T>,
): Promise<Result<T | undefined, "unreadable">> => {
  const text = await readTextFile(path);
  if (!text.ok) return err(text.error);
  if (text.value === undefined) return ok(undefined);
  try {
    const parsed = schema.safeParse(JSON.parse(text.value));
    return parsed.success ? ok(parsed.data) : err("unreadable");
  } catch {
    return err("unreadable");
  }
};

/** Whether a folder exists (not a file of that name), or an error when that can't be told. */
export const isFolder = async (path: string): Promise<Result<boolean, "unreadable">> => {
  try {
    return ok((await stat(path)).isDirectory());
  } catch (error) {
    return hasCode(error, "ENOENT") ? ok(false) : err("unreadable");
  }
};

/** Whether anything (a file or a folder) is at `path`, or an error when that can't be told. */
export const exists = async (path: string): Promise<Result<boolean, "unreadable">> => {
  try {
    await stat(path);
    return ok(true);
  } catch (error) {
    return hasCode(error, "ENOENT") ? ok(false) : err("unreadable");
  }
};

/** The folders inside a folder, by name; an error when it can't be read, or doesn't exist. */
export const listSubfolders = async (path: string): Promise<Result<string[], "unreadable">> => {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    return ok(entries.flatMap((entry) => (entry.isDirectory() ? [entry.name] : [])));
  } catch {
    return err("unreadable");
  }
};

/** The names in a folder; none when the folder doesn't exist yet. */
export const listFolder = async (path: string): Promise<Result<string[], "unreadable">> => {
  try {
    return ok(await readdir(path));
  } catch (error) {
    return hasCode(error, "ENOENT") ? ok([]) : err("unreadable");
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
