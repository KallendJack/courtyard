import type { Dirent } from "node:fs";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
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
import { hasCode } from "../files.ts";
import { err, ok, type Result } from "../result.ts";

/**
 * The workspace folder as the edge of what a model may look at (ADRs 0003, 0015): the one check
 * every provider's reads go through, and Courtyard's own file tools for a provider that has none
 * of its own (Codex, whose shell is off).
 */

/** What a model is told when it reaches outside the workspace folder, whichever provider it's on. */
export const OUTSIDE_WORKSPACE = "Only files in this workspace's folder can be read.";

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

/** What one of Courtyard's file tools gives a model: text, or an image. */
export type FileToolContent =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "image"; readonly dataUrl: string };

/** A file tool's answer: what it found, or why it couldn't, in words for the model. */
export type FileToolAnswer = Result<readonly FileToolContent[], string>;

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

const MALFORMED = "That input doesn't fit this tool: check what each of its inputs takes.";
/** The most a read takes in, image or text. */
const MAX_FILE_BYTES = 10 * 1024 * 1024;
/** The most text one read gives back; a longer file is read on from where it stopped. */
export const READ_LINES = 2000;
const MAX_CHARACTERS = 100_000;
const MAX_LISTED = 500;
const MAX_MATCHES = 100;
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

const text = (words: string): FileToolContent => ({ kind: "text", text: words });

/** Whether bytes look like text: a zero byte near the start means they're not. */
const looksLikeText = (bytes: Buffer) => !bytes.subarray(0, 8000).includes(0);

/** Whether a file's path matches a glob; one without a slash matches its name in any folder. */
const matchesGlob = (shown: string, glob: string) =>
  posix.matchesGlob(shown, glob) ||
  (!glob.includes("/") && posix.matchesGlob(posix.basename(shown), glob));

const byName = (a: Dirent, b: Dirent) => a.name.localeCompare(b.name);

/** The text a read gives back: from `start` (counting from 1), as many lines as fit. */
const pageOf = (whole: string, start: number): FileToolAnswer => {
  const lines = whole.replace(/\r?\n$/, "").split(/\r?\n/);
  if (start > lines.length) return err(`The file has ${lines.length} lines.`);
  const shown: string[] = [];
  let characters = 0;
  for (const line of lines.slice(start - 1, start - 1 + READ_LINES)) {
    if (shown.length > 0 && characters + line.length > MAX_CHARACTERS) break;
    shown.push(line);
    characters += line.length + 1;
  }
  const end = start + shown.length - 1;
  const more =
    end < lines.length
      ? `\n\n(Lines ${start} to ${end} of ${lines.length}. Read on with start_line ${end + 1}.)`
      : "";
  return ok([text(shown.join("\n") + more)]);
};

/**
 * Courtyard's file tools for one turn (docs/ai-conduct.md, Courtyard's file tools): list a folder,
 * read a file and search the files' text, each confined to the workspace folder with the same
 * check as every read. Each file read is reported. A tool never throws: anything that goes wrong
 * is an answer for the model.
 */
export const workspaceFiles = (options: {
  readonly folder: string;
  readonly report: (activity: Activity) => Promise<void>;
}) => {
  const folder = resolve(options.folder);

  const list = async (input: unknown): Promise<FileToolAnswer> => {
    const parsed = ListInput.safeParse(input);
    if (!parsed.success) return err(MALFORMED);
    const path = parsed.data.path ?? ".";
    if (!(await staysInside(folder, { paths: [path], globs: [] }))) return err(OUTSIDE_WORKSPACE);
    let entries: Dirent[];
    try {
      entries = await readdir(resolve(folder, path), { withFileTypes: true });
    } catch (error) {
      if (hasCode(error, "ENOENT")) return err(`There's no folder at ${path}.`);
      if (hasCode(error, "ENOTDIR")) return err(`${path} is a file: read it instead.`);
      return err("That folder couldn't be read.");
    }
    if (entries.length === 0) return ok([text("The folder is empty.")]);
    const names = entries.sort(byName).map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
    const rest = names.length - MAX_LISTED;
    return ok([
      text(names.slice(0, MAX_LISTED).join("\n") + (rest > 0 ? `\n…and ${rest} more.` : "")),
    ]);
  };

  const read = async (input: unknown): Promise<FileToolAnswer> => {
    const parsed = ReadInput.safeParse(input);
    if (!parsed.success) return err(MALFORMED);
    const { path } = parsed.data;
    if (!(await staysInside(folder, { paths: [path], globs: [] }))) return err(OUTSIDE_WORKSPACE);
    const file = resolve(folder, path);
    try {
      const info = await stat(file);
      if (info.isDirectory()) return err(`${path} is a folder: list it instead.`);
      if (info.size > MAX_FILE_BYTES) return err("That file is too large to read.");
      await options.report({ kind: "read-file", path: shownPath(folder, file) });
      const bytes = await readFile(file);
      const imageType = IMAGE_TYPES[extname(file).toLowerCase()];
      if (imageType !== undefined) {
        return ok([
          { kind: "image", dataUrl: `data:${imageType};base64,${bytes.toString("base64")}` },
        ]);
      }
      if (!looksLikeText(bytes))
        return err("That file isn't text or an image, so it can't be read.");
      return pageOf(bytes.toString("utf8"), parsed.data.start_line ?? 1);
    } catch (error) {
      return err(
        hasCode(error, "ENOENT") ? `There's no file at ${path}.` : "That file couldn't be read.",
      );
    }
  };

  const search = async (input: unknown): Promise<FileToolAnswer> => {
    const parsed = SearchInput.safeParse(input);
    if (!parsed.success) return err(MALFORMED);
    const path = parsed.data.path ?? ".";
    const glob = parsed.data.glob ?? undefined;
    const reach = { paths: [path], globs: glob === undefined ? [] : [glob] };
    if (!(await staysInside(folder, reach))) return err(OUTSIDE_WORKSPACE);
    const wanted = parsed.data.text.toLowerCase();
    const matches: string[] = [];

    const searchFile = async (file: string) => {
      const shown = shownPath(folder, file);
      if (glob !== undefined && !matchesGlob(shown, glob)) return;
      const info = await stat(file);
      if (!info.isFile() || info.size > MAX_SEARCHED_BYTES) return;
      const bytes = await readFile(file);
      if (!looksLikeText(bytes)) return;
      for (const [index, line] of bytes.toString("utf8").split(/\r?\n/).entries()) {
        if (matches.length >= MAX_MATCHES) return;
        if (line.toLowerCase().includes(wanted)) {
          matches.push(`${shown}:${index + 1}: ${line.trim().slice(0, MAX_MATCH_CHARACTERS)}`);
        }
      }
    };

    // Folders reached through a link aren't searched, so a link can't lead out or round in a
    // loop; a linked file is searched only when it leads somewhere inside.
    const searchFolder = async (inside: string): Promise<void> => {
      const entries = await readdir(inside, { withFileTypes: true }).catch(() => []);
      for (const entry of entries.sort(byName)) {
        if (matches.length >= MAX_MATCHES) return;
        const entryPath = join(inside, entry.name);
        if (entry.isDirectory()) await searchFolder(entryPath);
        else if (entry.isFile()) await searchFile(entryPath).catch(() => undefined);
        else if (
          entry.isSymbolicLink() &&
          (await staysInside(folder, { paths: [entryPath], globs: [] }))
        ) {
          await searchFile(entryPath).catch(() => undefined);
        }
      }
    };

    try {
      const start = resolve(folder, path);
      if ((await stat(start)).isDirectory()) await searchFolder(start);
      else await searchFile(start);
    } catch (error) {
      return err(
        hasCode(error, "ENOENT")
          ? `There's nothing at ${path}.`
          : "Those files couldn't be searched.",
      );
    }
    if (matches.length === 0) return ok([text("No matches.")]);
    const capped =
      matches.length >= MAX_MATCHES
        ? `\n\n(The first ${MAX_MATCHES} matches. Search for something narrower to see the rest.)`
        : "";
    return ok([text(matches.join("\n") + capped)]);
  };

  return { list, read, search };
};
