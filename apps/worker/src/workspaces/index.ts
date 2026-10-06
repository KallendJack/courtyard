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

/** A workspace as read from its folder, before its colour is settled. */
type Uncoloured = Omit<Workspace, "summary"> & {
  readonly summary: Omit<WorkspaceSummary, "colour">;
  /** The colour its config keeps, if any. */
  readonly keptColour: WorkspaceColour | undefined;
};

/** A workspace in the list, and whether its config keeps its colour. */
type Listed = { readonly workspace: Workspace; readonly colourKept: boolean };

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
): Promise<Result<Uncoloured, WorkspaceError>> => {
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
  const valid = config.kind === "read" ? config : undefined;

  return ok({
    summary: {
      id,
      name: valid?.name ?? contextFile?.title ?? id,
      mode: valid?.mode ?? "planning",
      hasContextFile: contextFile !== null,
      ...(config.kind === "ignored" ? { configProblem: config.problem } : {}),
    },
    keptColour: valid?.colour,
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
 * Settles each workspace's colour. A workspace has the colour its config keeps. One without (made
 * by hand, or before colours were kept) takes the colours in turn, in folder-name order among the
 * others without one, until adding or changing a workspace keeps it (see `keepColours`).
 */
const withColours = (workspaces: readonly Uncoloured[]): Listed[] => {
  const uncoloured = workspaces.flatMap((w) => (w.keptColour === undefined ? [w.summary.id] : []));
  uncoloured.sort();
  return workspaces.map(({ keptColour, summary, ...rest }) => {
    const turn = COLOURS[uncoloured.indexOf(summary.id) % COLOURS.length];
    return {
      workspace: { ...rest, summary: { ...summary, colour: keptColour ?? turn ?? "bracken" } },
      colourKept: keptColour !== undefined,
    };
  });
};

/** Every workspace in the context folder, in folder order. */
const readEveryWorkspace = async (
  contextDir: string,
): Promise<Result<Listed[], WorkspaceError>> => {
  const ids = await workspaceIds(contextDir);
  if (!ids.ok) return ids;
  const workspaces: Uncoloured[] = [];
  for (const workspace of await Promise.all(ids.value.map((id) => readWorkspace(contextDir, id)))) {
    if (!workspace.ok) return workspace;
    workspaces.push(workspace.value);
  }
  return ok(withColours(workspaces));
};

/** Compares names the way the owner reads them: "Garage gym" and "garage Gym" are the same. */
const compareNames = (a: string, b: string) =>
  a.localeCompare(b, undefined, { sensitivity: "base" });

const byName = (a: WorkspaceSummary, b: WorkspaceSummary) => compareNames(a.name, b.name);

/** Every workspace in the context folder, by name. */
export const listWorkspaces = async (
  contextDir: string,
): Promise<Result<WorkspaceSummary[], WorkspaceError>> => {
  const every = await readEveryWorkspace(contextDir);
  if (!every.ok) return every;
  return ok(every.value.map((listed) => listed.workspace.summary).sort(byName));
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
  const [own] = withColours([read.value]);
  if (own?.colourKept) return ok(own.workspace);

  // Without a kept colour, a workspace's colour depends on which others have one.
  const every = await readEveryWorkspace(contextDir);
  if (!every.ok) return every;
  const listed = every.value.find((w) => w.workspace.summary.id === parsed.data);
  return listed ? ok(listed.workspace) : err({ kind: "not-found" });
};

/** Keeps a colour in a workspace's config, alongside whatever else is there. */
const keepColour = async (
  workspace: Workspace,
  colour: WorkspaceColour,
): Promise<Result<null, WorkspaceError>> => {
  // Read as it is on disk, so fields the worker doesn't know about are kept too.
  const path = join(workspace.folder, CONFIG_FILE);
  const config = await readJsonFile(path, z.record(z.string(), z.unknown()));
  const written = config.ok ? await writeJsonFile(path, { ...config.value, colour }) : config;
  return written.ok
    ? ok(null)
    : err({
        kind: "storage",
        message: `The ${workspace.summary.id} workspace's ${CONFIG_FILE} can't be saved.`,
      });
};

/**
 * Keeps the colour each workspace has now, for those whose config doesn't yet, so adding or
 * changing a workspace never moves another's. A config that was ignored is left for the owner.
 */
const keepColours = async (every: readonly Listed[]): Promise<Result<null, WorkspaceError>> => {
  for (const { workspace, colourKept } of every) {
    if (colourKept || workspace.summary.configProblem !== undefined) continue;
    const kept = await keepColour(workspace, workspace.summary.colour);
    if (!kept.ok) return kept;
  }
  return ok(null);
};

/** Names Windows keeps for devices, which can't be folder names there. */
const RESERVED_ON_WINDOWS = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/;

/** Letters with no plain form once accents are taken off. */
const PLAIN_LETTERS: Record<string, string> = {
  ß: "ss",
  æ: "ae",
  œ: "oe",
  ø: "o",
  đ: "d",
  ł: "l",
  þ: "th",
};

/**
 * The folder name for a workspace called `name`: its letters and digits, lowercase and without
 * accents, with a dash between words. "Nan's 80th Birthday!" is `nans-80th-birthday`.
 */
const folderNameFor = (name: string): Result<WorkspaceId, WorkspaceError> => {
  const folderName = name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[ßæœøđłþ]/g, (letter) => PLAIN_LETTERS[letter] ?? letter)
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
const nextColour = (every: readonly Listed[]) => {
  const uses = (colour: WorkspaceColour) =>
    every.filter((w) => w.workspace.summary.colour === colour).length;
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

/** Writes a new workspace's context file and config into its empty folder. */
const writeStarterFiles = async (
  folder: string,
  starter: { name: string; colour: WorkspaceColour },
): Promise<Result<null, WorkspaceError>> => {
  const problem: WorkspaceError = {
    kind: "storage",
    message: "The new workspace couldn't be saved.",
  };
  try {
    await writeFile(join(folder, CONTEXT_FILE), starterContextFile(starter.name), { flag: "wx" });
  } catch {
    return err(problem);
  }
  const config = { colour: starter.colour };
  const written = await writeJsonFile(join(folder, CONFIG_FILE), config, { exclusive: true });
  return written.ok ? ok(null) : err(problem);
};

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
  const every = await readEveryWorkspace(contextDir);
  if (!every.ok) return every;
  const clash = every.value.find(({ workspace: { summary } }) => {
    return summary.id === id.value || compareNames(summary.name, name) === 0;
  });
  if (clash) {
    const message = `There's already a workspace called ${clash.workspace.summary.name}.`;
    return err({ kind: "conflict", message });
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

  const saved = await writeStarterFiles(folder, { name, colour: nextColour(every.value) });
  if (!saved.ok) {
    // Half a workspace would just confuse things later.
    await rm(folder, { recursive: true, force: true }).catch(() => undefined);
    return saved;
  }
  const kept = await keepColours(every.value);
  if (!kept.ok) return kept;

  const created = await getWorkspace(contextDir, id.value);
  return created.ok ? ok(created.value.summary) : created;
};

/**
 * Gives a workspace a new colour, kept in its config. A config that was ignored is left for the
 * owner to fix rather than overwritten.
 */
export const setWorkspaceColour = async (
  contextDir: string,
  change: { id: string; colour: WorkspaceColour },
): Promise<Result<WorkspaceSummary, WorkspaceError>> => {
  const every = await readEveryWorkspace(contextDir);
  if (!every.ok) return every;
  const listed = every.value.find((w) => w.workspace.summary.id === change.id);
  if (!listed) return err({ kind: "not-found" });
  const { summary } = listed.workspace;
  if (summary.configProblem !== undefined) {
    return err({
      kind: "conflict",
      message: `${summary.configProblem} Fix it, then choose the colour again.`,
    });
  }

  const others = await keepColours(every.value.filter((w) => w !== listed));
  if (!others.ok) return others;
  const kept = await keepColour(listed.workspace, change.colour);
  return kept.ok ? ok({ ...summary, colour: change.colour }) : kept;
};
