import { realpath } from "node:fs/promises";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  posix,
  relative,
  resolve,
  sep,
} from "node:path";
import type { Activity } from "@courtyard/contract";
import { z } from "zod";
import { entryAt, type FolderEntry, listEntries, readBytes } from "../files.ts";
import { err, ok, type Result } from "../result.ts";

/**
 * The workspace folder as the edge of what a model may look at (ADRs 0003, 0015): the one check
 * every provider's reads go through, and Courtyard's own file tools for a provider that has none
 * of its own (Codex, whose shell is off). The prompts module words what the tools find for the
 * model.
 */

/**
 * Where a path really leads, following symlinks. For a path that doesn't exist yet, the nearest
 * existing folder above it is followed instead, and the rest is added back.
 */
const realLocation = async (path: string): Promise<string> => {
  try {
    return await realpath(path);
  } catch {
    const parent = dirname(path);
    return parent === path ? path : join(await realLocation(parent), basename(path));
  }
};

const isWithin = (folder: string, path: string) => {
  const fromFolder = relative(folder, path);
  return fromFolder === "" || (!fromFolder.startsWith("..") && !isAbsolute(fromFolder));
};

/** A glob that could match outside the folder: it starts somewhere absolute or climbs with `..`. */
const reachesOut = (glob: string) => isAbsolute(glob) || glob.includes("..");

/**
 * Whether everything a read names stays inside the workspace folder: each path once symlinks are
 * followed (taken from the folder unless it's absolute), and each glob.
 */
export const staysInside = async (
  folder: string,
  reach: { readonly paths: readonly string[]; readonly globs: readonly string[] },
) => {
  if (reach.globs.some(reachesOut)) return false;
  const realFolder = await realLocation(resolve(folder));
  const realPaths = await Promise.all(reach.paths.map((p) => realLocation(resolve(folder, p))));
  return realPaths.every((p) => isWithin(realFolder, p));
};

/** A path as the owner sees it in an activity: from the workspace folder, with forward slashes. */
export const shownPath = (folder: string, path: string) =>
  relative(folder, resolve(folder, path)).split(sep).join("/");

/** What a file tool found. */
export type FileToolFound =
  | { readonly kind: "listing"; readonly names: readonly string[]; readonly more: number }
  /** Part of a text file: lines `start` to `end` (counting from 1) of `total`. */
  | {
      readonly kind: "text";
      readonly text: string;
      readonly start: number;
      readonly end: number;
      readonly total: number;
    }
  | { readonly kind: "image"; readonly dataUrl: string }
  /** Matching lines, `path:line: text`; `stopped` when the search stopped before the end. */
  | { readonly kind: "matches"; readonly lines: readonly string[]; readonly stopped: boolean };

/** Why a file tool found nothing. */
export type FileToolRefusal =
  | { readonly kind: "malformed" }
  | { readonly kind: "outside" }
  | { readonly kind: "missing"; readonly path: string }
  | { readonly kind: "not-a-folder"; readonly path: string }
  | { readonly kind: "not-a-file"; readonly path: string }
  | { readonly kind: "too-large" }
  | { readonly kind: "not-text" }
  | { readonly kind: "past-the-end"; readonly total: number }
  | { readonly kind: "unreadable" };

export type FileToolAnswer = Result<FileToolFound, FileToolRefusal>;

/**
 * Each tool's input as the prompts module describes it. Strict, so a field Courtyard doesn't know
 * about (a new way to name a path) is refused rather than let through unchecked. A model may send
 * `null` for an input it leaves out.
 */
const ListInput = z.strictObject({ path: z.string().nullish() });
const ReadInput = z.strictObject({
  path: z.string(),
  start_line: z.number().int().min(1).nullish(),
});
const SearchInput = z.strictObject({
  text: z.string().min(1),
  path: z.string().nullish(),
  glob: z.string().nullish(),
});

/** The most a read takes in, image or text. */
const MAX_FILE_BYTES = 10 * 1024 * 1024;
/** The most text one read gives back; a longer file is read on from where it stopped. */
export const READ_LINES = 2000;
const MAX_CHARACTERS = 100_000;
const MAX_LISTED = 500;
const MAX_MATCHES = 100;
/** The most files one search opens, so a huge folder can't keep a turn waiting. */
const MAX_SEARCHED_FILES = 5000;
/** A file searched is at most this big, and a matching line is shown up to this long. */
const MAX_SEARCHED_BYTES = 1024 * 1024;
const MAX_MATCH_CHARACTERS = 300;
/** The images a read gives as images, by extension. */
const IMAGE_TYPES: Readonly<Record<string, string>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

/** Whether bytes look like text: a zero byte near the start means they're not. */
const looksLikeText = (bytes: Buffer) => !bytes.subarray(0, 8000).includes(0);

/** Whether a file's path matches a glob; one without a slash matches its name in any folder. */
const matchesGlob = (shown: string, glob: string) =>
  posix.matchesGlob(shown, glob) ||
  (!glob.includes("/") && posix.matchesGlob(posix.basename(shown), glob));

const byName = (a: FolderEntry, b: FolderEntry) => a.name.localeCompare(b.name);

/** Part of a text file: from `start` (counting from 1), as many lines as fit, the last cut short. */
const pageOf = (whole: string, start: number): FileToolAnswer => {
  const lines = whole.replace(/\r?\n$/, "").split(/\r?\n/);
  if (start > lines.length) return err({ kind: "past-the-end", total: lines.length });
  const shown: string[] = [];
  let left = MAX_CHARACTERS;
  for (const line of lines.slice(start - 1, start - 1 + READ_LINES)) {
    if (left <= 0) break;
    shown.push(line.slice(0, left));
    left -= line.length + 1;
  }
  const text = shown.join("\n");
  return ok({ kind: "text", text, start, end: start + shown.length - 1, total: lines.length });
};

/**
 * Courtyard's file tools for one turn (docs/ai-conduct.md, Courtyard's file tools): list a folder,
 * read a file and search the files' text, each confined to the workspace folder with the same
 * check as every read. Each file given to the model is reported as read. A tool never throws:
 * anything that goes wrong is a refusal.
 */
export const workspaceFiles = (options: {
  readonly folder: string;
  readonly report: (activity: Activity) => Promise<void>;
}) => {
  const folder = resolve(options.folder);
  /** A glob as the model wrote it, with forward slashes whichever separator it used. */
  const forwardSlashes = (glob: string) => glob.replaceAll("\\", "/");

  const list = async (input: unknown): Promise<FileToolAnswer> => {
    const parsed = ListInput.safeParse(input);
    if (!parsed.success) return err({ kind: "malformed" });
    const path = parsed.data.path ?? ".";
    if (!(await staysInside(folder, { paths: [path], globs: [] }))) return err({ kind: "outside" });
    const entries = await listEntries(resolve(folder, path));
    if (!entries.ok) {
      return err(
        entries.error === "unreadable" ? { kind: "unreadable" } : { kind: entries.error, path },
      );
    }
    const names = entries.value
      .sort(byName)
      .map((entry) => (entry.kind === "folder" ? `${entry.name}/` : entry.name));
    return ok({
      kind: "listing",
      names: names.slice(0, MAX_LISTED),
      more: Math.max(0, names.length - MAX_LISTED),
    });
  };

  const read = async (input: unknown): Promise<FileToolAnswer> => {
    const parsed = ReadInput.safeParse(input);
    if (!parsed.success) return err({ kind: "malformed" });
    const { path } = parsed.data;
    if (!(await staysInside(folder, { paths: [path], globs: [] }))) return err({ kind: "outside" });
    const file = resolve(folder, path);
    const entry = await entryAt(file);
    if (!entry.ok) return err({ kind: "unreadable" });
    if (entry.value === undefined) return err({ kind: "missing", path });
    if (entry.value.kind !== "file") return err({ kind: "not-a-file", path });
    if (entry.value.size > MAX_FILE_BYTES) return err({ kind: "too-large" });
    const bytes = await readBytes(file);
    if (!bytes.ok) return err({ kind: "unreadable" });
    if (bytes.value === undefined) return err({ kind: "missing", path });

    const imageType = IMAGE_TYPES[extname(file).toLowerCase()];
    const found: FileToolAnswer =
      imageType !== undefined
        ? ok({
            kind: "image",
            dataUrl: `data:${imageType};base64,${bytes.value.toString("base64")}`,
          })
        : looksLikeText(bytes.value)
          ? pageOf(bytes.value.toString("utf8"), parsed.data.start_line ?? 1)
          : err({ kind: "not-text" });
    if (found.ok) await options.report({ kind: "read-file", path: shownPath(folder, file) });
    return found;
  };

  const search = async (input: unknown): Promise<FileToolAnswer> => {
    const parsed = SearchInput.safeParse(input);
    if (!parsed.success) return err({ kind: "malformed" });
    const path = parsed.data.path ?? ".";
    const glob = parsed.data.glob == null ? undefined : forwardSlashes(parsed.data.glob);
    const reach = { paths: [path], globs: glob === undefined ? [] : [glob] };
    if (!(await staysInside(folder, reach))) return err({ kind: "outside" });
    const wanted = parsed.data.text.toLowerCase();
    const lines: string[] = [];
    let searched = 0;
    const done = () => lines.length >= MAX_MATCHES || searched >= MAX_SEARCHED_FILES;

    const searchFile = async (file: string) => {
      const shown = shownPath(folder, file);
      if (glob !== undefined && !matchesGlob(shown, glob)) return;
      const entry = await entryAt(file);
      if (!entry.ok || entry.value?.kind !== "file" || entry.value.size > MAX_SEARCHED_BYTES)
        return;
      searched += 1;
      const bytes = await readBytes(file);
      if (!bytes.ok || bytes.value === undefined || !looksLikeText(bytes.value)) return;
      for (const [index, line] of bytes.value.toString("utf8").split(/\r?\n/).entries()) {
        if (lines.length >= MAX_MATCHES) return;
        if (line.toLowerCase().includes(wanted)) {
          lines.push(`${shown}:${index + 1}: ${line.trim().slice(0, MAX_MATCH_CHARACTERS)}`);
        }
      }
    };

    // Folders reached through a link aren't searched, so a link can't lead out or round in a
    // loop; a linked file is searched only when it leads somewhere inside.
    const searchFolder = async (inside: string): Promise<void> => {
      const entries = await listEntries(inside);
      if (!entries.ok) return;
      for (const entry of entries.value.sort(byName)) {
        if (done()) return;
        const entryPath = join(inside, entry.name);
        if (entry.kind === "folder") await searchFolder(entryPath);
        else if (entry.kind === "file") await searchFile(entryPath);
        else if (
          entry.kind === "link" &&
          (await staysInside(folder, { paths: [entryPath], globs: [] }))
        ) {
          await searchFile(entryPath);
        }
      }
    };

    const start = resolve(folder, path);
    const entry = await entryAt(start);
    if (!entry.ok) return err({ kind: "unreadable" });
    if (entry.value === undefined) return err({ kind: "missing", path });
    if (entry.value.kind === "folder") await searchFolder(start);
    else await searchFile(start);
    return ok({ kind: "matches", lines, stopped: done() });
  };

  return { list, read, search };
};
