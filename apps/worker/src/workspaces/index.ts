import type { Dirent } from "node:fs";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type ContextFile,
  WorkspaceColour,
  WorkspaceId,
  WorkspaceMode,
  type WorkspaceSummary,
} from "@courtyard/contract";
import { z } from "zod";
import { parseContextFile } from "../context-file/index.ts";
import { hasCode, readJsonFile, writeJsonFile } from "../files.ts";
import { err, ok, type Result } from "../result.ts";

const CONTEXT_FILE = "CONTEXT.md";
const CONFIG_FILE = "workspace.json";
const COLOURS = WorkspaceColour.options;

/** A workspace's optional `workspace.json`. Without one, a workspace is a planning workspace. */
const WorkspaceConfig = z
  .object({
    name: z.string().trim().min(1).optional(),
    mode: WorkspaceMode.default("planning"),
    /** The git repository a code workspace works on, on the worker machine. */
    repoPath: z.string().min(1).optional(),
    colour: WorkspaceColour.optional(),
  })
  .refine((config) => config.mode !== "code" || config.repoPath !== undefined, {
    message: "is required for a code workspace",
    path: ["repoPath"],
  });

type Config =
  | { readonly kind: "absent" }
  | {
      readonly kind: "read";
      readonly name?: string;
      readonly mode: WorkspaceMode;
      readonly colour?: WorkspaceColour;
    }
  | { readonly kind: "ignored"; readonly problem: string };

type Workspace = {
  readonly summary: WorkspaceSummary;
  readonly contextFile: ContextFile | null;
  /** The workspace's folder on the worker machine. */
  readonly folder: string;
  /** The context file exactly as written, for models to read. */
  readonly contextMarkdown: string | null;
};

/** A workspace as read from its folder, before it has a colour for sure. */
type Read = Omit<Workspace, "summary"> & {
  readonly summary: Omit<WorkspaceSummary, "colour">;
  /** The colour its config gives it, if any. */
  readonly colour: WorkspaceColour | undefined;
};

/** Why a workspace couldn't be read, added or changed. */
export type WorkspaceError =
  | { readonly kind: "not-found" }
  /** What the owner asked for can't be done as asked. */
  | { readonly kind: "invalid"; readonly message: string }
  /** It clashes with what's already in the context folder. */
  | { readonly kind: "conflict"; readonly message: string }
  | { readonly kind: "storage"; readonly message: string };

const CONTEXT_FOLDER_UNREADABLE: WorkspaceError = {
  kind: "storage",
  message: "The context folder can't be read.",
};

/** A file's text, `undefined` when it doesn't exist, or an error when it exists but can't be read. */
const readIfPresent = async (path: string): Promise<Result<string | undefined, unknown>> => {
  try {
    return ok(await readFile(path, "utf8"));
  } catch (error) {
    return hasCode(error, "ENOENT") ? ok(undefined) : err(error);
  }
};

const readConfig = async (folder: string): Promise<Config> => {
  const text = await readIfPresent(join(folder, CONFIG_FILE));
  if (!text.ok)
    return { kind: "ignored", problem: `${CONFIG_FILE} can't be read, so it was ignored.` };
  if (text.value === undefined) return { kind: "absent" };

  let json: unknown;
  try {
    json = JSON.parse(text.value);
  } catch {
    return { kind: "ignored", problem: `${CONFIG_FILE} isn't valid JSON, so it was ignored.` };
  }

  const parsed = WorkspaceConfig.safeParse(json);
  if (!parsed.success) {
    const reasons = parsed.error.issues.map((i) => `${i.path.join(".") || "it"} ${i.message}`);
    return { kind: "ignored", problem: `${CONFIG_FILE} was ignored: ${reasons.join("; ")}.` };
  }
  const { name, mode, colour } = parsed.data;
  return {
    kind: "read",
    mode,
    ...(name === undefined ? {} : { name }),
    ...(colour === undefined ? {} : { colour }),
  };
};

const readWorkspace = async (
  contextDir: string,
  id: WorkspaceId,
): Promise<Result<Read, WorkspaceError>> => {
  const folder = join(contextDir, id);
  const [config, markdown] = await Promise.all([
    readConfig(folder),
    readIfPresent(join(folder, CONTEXT_FILE)),
  ]);
  if (!markdown.ok) {
    return err({
      kind: "storage",
      message: `The ${id} workspace's ${CONTEXT_FILE} can't be read.`,
    });
  }
  const contextFile = markdown.value === undefined ? null : parseContextFile(markdown.value);
  const read = config.kind === "read" ? config : undefined;

  return ok({
    summary: {
      id,
      name: read?.name ?? contextFile?.title ?? id,
      mode: read?.mode ?? "planning",
      hasContextFile: contextFile !== null,
      ...(config.kind === "ignored" ? { configProblem: config.problem } : {}),
    },
    colour: read?.colour,
    contextFile,
    folder,
    contextMarkdown: markdown.value ?? null,
  });
};

/** The workspace ids in the context folder: folders named like one (so not `.git`), not files. */
const workspaceIds = async (contextDir: string): Promise<Result<WorkspaceId[], WorkspaceError>> => {
  let entries: Dirent[];
  try {
    entries = await readdir(contextDir, { withFileTypes: true });
  } catch {
    return err(CONTEXT_FOLDER_UNREADABLE);
  }
  return ok(
    entries.flatMap((entry) => {
      const id = WorkspaceId.safeParse(entry.name);
      return entry.isDirectory() && id.success ? [id.data] : [];
    }),
  );
};

/**
 * Each workspace's colour. A workspace keeps the colour its config gives it. One without (made by
 * hand, or before colours were kept) takes the colours in turn, in folder-name order among the
 * others without one, so adding a workspace from the app never moves anyone's colour.
 */
const coloursOf = (
  workspaces: readonly { readonly id: WorkspaceId; readonly colour: WorkspaceColour | undefined }[],
) => {
  const uncoloured = workspaces.flatMap((w) => (w.colour === undefined ? [w.id] : [])).sort();
  return new Map(
    workspaces.map((w) => [
      w.id,
      w.colour ?? COLOURS[uncoloured.indexOf(w.id) % COLOURS.length] ?? "bracken",
    ]),
  );
};

const withColour = (read: Read, colours: Map<WorkspaceId, WorkspaceColour>): Workspace => ({
  summary: { ...read.summary, colour: colours.get(read.summary.id) ?? "bracken" },
  contextFile: read.contextFile,
  folder: read.folder,
  contextMarkdown: read.contextMarkdown,
});

/** Compares names the way the owner reads them: "Garage gym" and "garage Gym" are the same. */
const compareNames = (a: string, b: string) =>
  a.localeCompare(b, undefined, { sensitivity: "base" });

const byName = (a: WorkspaceSummary, b: WorkspaceSummary) => compareNames(a.name, b.name);

/** Every workspace in the context folder, by name. */
export const listWorkspaces = async (
  contextDir: string,
): Promise<Result<WorkspaceSummary[], WorkspaceError>> => {
  const ids = await workspaceIds(contextDir);
  if (!ids.ok) return ids;
  const reads: Read[] = [];
  for (const workspace of await Promise.all(ids.value.map((id) => readWorkspace(contextDir, id)))) {
    if (!workspace.ok) return workspace;
    reads.push(workspace.value);
  }
  const colours = coloursOf(reads.map((read) => ({ id: read.summary.id, colour: read.colour })));
  return ok(reads.map((read) => withColour(read, colours).summary).sort(byName));
};

/** One workspace with its context file. */
export const getWorkspace = async (
  contextDir: string,
  id: string,
): Promise<Result<Workspace, WorkspaceError>> => {
  const parsed = WorkspaceId.safeParse(id);
  if (!parsed.success) return err({ kind: "not-found" });

  let folder: Awaited<ReturnType<typeof stat>> | undefined;
  try {
    folder = await stat(join(contextDir, parsed.data));
  } catch (error) {
    if (!hasCode(error, "ENOENT")) return err(CONTEXT_FOLDER_UNREADABLE);
  }
  if (!folder?.isDirectory()) return err({ kind: "not-found" });
  const read = await readWorkspace(contextDir, parsed.data);
  if (!read.ok) return read;
  if (read.value.colour !== undefined) {
    return ok(withColour(read.value, new Map([[parsed.data, read.value.colour]])));
  }

  // Without its own colour, a workspace's colour depends on which others have one.
  const ids = await workspaceIds(contextDir);
  if (!ids.ok) return ids;
  const configs = await Promise.all(ids.value.map((other) => readConfig(join(contextDir, other))));
  const colours = coloursOf(
    ids.value.map((other, index) => {
      const config = configs[index];
      return { id: other, colour: config?.kind === "read" ? config.colour : undefined };
    }),
  );
  return ok(withColour(read.value, colours));
};

/** Names Windows keeps for devices, which can't be folder names there. */
const RESERVED_ON_WINDOWS = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/;

/**
 * The folder name for a workspace called `name`: its letters and digits, lowercase and without
 * accents, with a dash between words. "Nan's 80th Birthday!" is `nans-80th-birthday`.
 */
const folderNameFor = (name: string): Result<WorkspaceId, WorkspaceError> => {
  const folderName = name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const id = WorkspaceId.safeParse(folderName);
  if (!id.success) {
    return err({
      kind: "invalid",
      message:
        "Use at least one letter or number from a to z or 0 to 9, so the name can be a folder name.",
    });
  }
  if (RESERVED_ON_WINDOWS.test(id.data)) {
    return err({
      kind: "invalid",
      message: `"${id.data}" can't be a folder name on Windows. Choose another name.`,
    });
  }
  return ok(id.data);
};

/** The colour the fewest workspaces have, earliest in the list on a tie. */
const nextColour = (workspaces: readonly WorkspaceSummary[]) => {
  const uses = (colour: WorkspaceColour) => workspaces.filter((w) => w.colour === colour).length;
  return COLOURS.reduce((fewest, colour) => (uses(colour) < uses(fewest) ? colour : fewest));
};

/**
 * A new workspace's context file: its title, then empty Facts, Plans and Ideas, with a line on
 * how to fill them in (docs/ai-conduct.md, "Starter context file").
 */
const starterContextFile = (name: string) =>
  [
    `# ${name}`,
    "",
    "Write one line for each fact, plan or idea. Facts are true now, plans are decided but not done, and ideas are being considered.",
    "",
    "## Facts",
    "",
    "## Plans",
    "",
    "## Ideas",
    "",
  ].join("\n");

/**
 * Adds a workspace called `name`: its folder, a starter context file, and the next colour, kept
 * in its config. Refuses a name that can't be a folder name or that another workspace has.
 */
export const createWorkspace = async (
  contextDir: string,
  name: string,
): Promise<Result<WorkspaceSummary, WorkspaceError>> => {
  const id = folderNameFor(name);
  if (!id.ok) return id;
  const existing = await listWorkspaces(contextDir);
  if (!existing.ok) return existing;
  const clash = existing.value.find((w) => w.id === id.value || compareNames(w.name, name) === 0);
  if (clash) {
    return err({ kind: "conflict", message: `There's already a workspace called ${clash.name}.` });
  }

  const folder = join(contextDir, id.value);
  try {
    // Not recursive: an existing folder or file of that name is a clash, not something to reuse.
    await mkdir(folder);
  } catch (error) {
    return hasCode(error, "EEXIST")
      ? err({
          kind: "conflict",
          message: `The context folder already has something called ${id.value}. Choose another name.`,
        })
      : err({ kind: "storage", message: "The context folder can't be written to." });
  }

  const colour = nextColour(existing.value);
  try {
    await writeFile(join(folder, CONTEXT_FILE), starterContextFile(name), { flag: "wx" });
    const config = await writeJsonFile(join(folder, CONFIG_FILE), { colour }, { exclusive: true });
    if (!config.ok) throw new Error(config.error);
  } catch {
    // Half a workspace would just confuse things later.
    await rm(folder, { recursive: true, force: true }).catch(() => undefined);
    return err({ kind: "storage", message: "The new workspace couldn't be saved." });
  }

  const created = await getWorkspace(contextDir, id.value);
  return created.ok ? ok(created.value.summary) : created;
};

/**
 * Gives a workspace a new colour, kept in its config alongside whatever else is there. A config
 * that was ignored is left for the owner to fix rather than overwritten.
 */
export const setWorkspaceColour = async (
  contextDir: string,
  change: { id: string; colour: WorkspaceColour },
): Promise<Result<WorkspaceSummary, WorkspaceError>> => {
  const workspace = await getWorkspace(contextDir, change.id);
  if (!workspace.ok) return workspace;
  const { summary, folder } = workspace.value;
  if (summary.configProblem !== undefined) {
    return err({
      kind: "conflict",
      message: `${summary.configProblem} Fix it, then choose the colour again.`,
    });
  }

  // Read as it is on disk, so fields the worker doesn't know about are kept too.
  const path = join(folder, CONFIG_FILE);
  const config = await readJsonFile(path, z.record(z.string(), z.unknown()));
  // It read cleanly a moment ago, so this only fails if it changed since.
  if (!config.ok) return err({ kind: "conflict", message: `${CONFIG_FILE} changed. Try again.` });

  const written = await writeJsonFile(path, { ...config.value, colour: change.colour });
  if (!written.ok) return err({ kind: "storage", message: `${CONFIG_FILE} can't be saved.` });
  return ok({ ...summary, colour: change.colour });
};
