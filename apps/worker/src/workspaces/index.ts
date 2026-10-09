import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type ContextFile,
  type NewWorkspace,
  WorkspaceColour,
  WorkspaceId,
  WorkspaceMode,
  type WorkspaceSummary,
} from "@courtyard/contract";
import { z } from "zod";
import { parseContextFile } from "../context-file/index.ts";
import {
  hasCode,
  isFolder,
  listSubfolders,
  move,
  readJsonFile,
  readTextFile,
  writeJsonFile,
} from "../files.ts";
import { err, ok, type Result } from "../result.ts";

export const CONTEXT_FILE = "CONTEXT.md";
const CONFIG_FILE = "workspace.json";
/**
 * The folder in the context folder that archived workspaces move to. Named like a workspace, so
 * it's kept out of the list by name, and no workspace can be called that.
 */
export const ARCHIVED_FOLDER = "archived";
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
      readonly repoPath?: string;
    }
  | { readonly kind: "ignored"; readonly problem: string };

export type Workspace = {
  readonly summary: WorkspaceSummary;
  readonly contextFile: ContextFile | null;
  /** The workspace's folder on the worker machine. */
  readonly folder: string;
  /** The context file exactly as written, for models to read. */
  readonly contextMarkdown: string | null;
  /** A code workspace's repository on the worker machine, as its config names it. */
  readonly repoPath: string | null;
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
  /** Its folder is in the archived folder. */
  | { readonly kind: "archived" }
  /** What the owner asked for can't be done as asked. */
  | { readonly kind: "invalid"; readonly message: string }
  /** It clashes with what's already in the context folder. */
  | { readonly kind: "conflict"; readonly message: string }
  | { readonly kind: "storage"; readonly message: string };

const CONTEXT_FOLDER_UNREADABLE: WorkspaceError = {
  kind: "storage",
  message: "The context folder can't be read.",
};

const readConfig = async (folder: string): Promise<Config> => {
  const text = await readTextFile(join(folder, CONFIG_FILE));
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
  const { name, mode, colour, repoPath } = parsed.data;
  return {
    kind: "read",
    mode,
    ...(name === undefined ? {} : { name }),
    ...(colour === undefined ? {} : { colour }),
    ...(repoPath === undefined ? {} : { repoPath }),
  };
};

const readWorkspace = async (
  contextDir: string,
  id: WorkspaceId,
): Promise<Result<Uncoloured, WorkspaceError>> => {
  const folder = join(contextDir, id);
  const [config, markdown] = await Promise.all([
    readConfig(folder),
    readTextFile(join(folder, CONTEXT_FILE)),
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
    repoPath: valid?.mode === "code" ? (valid.repoPath ?? null) : null,
  });
};

/** A folder name as a workspace id, unless it can't be one (`.git`, or the archived folder). */
const workspaceIdFrom = (name: string): WorkspaceId | undefined => {
  const id = WorkspaceId.safeParse(name);
  return id.success && id.data !== ARCHIVED_FOLDER ? id.data : undefined;
};

/** The workspace ids in the context folder: folders named like one, not files. */
const workspaceIds = async (contextDir: string): Promise<Result<WorkspaceId[], WorkspaceError>> => {
  const folders = await listSubfolders(contextDir);
  if (!folders.ok) return err(CONTEXT_FOLDER_UNREADABLE);
  return ok(
    folders.value.flatMap((name) => {
      const id = workspaceIdFrom(name);
      return id === undefined ? [] : [id];
    }),
  );
};

/** Whether a folder in the context folder exists, or an error when that can't be told. */
const isWorkspaceFolder = async (path: string): Promise<Result<boolean, WorkspaceError>> => {
  const found = await isFolder(path);
  return found.ok ? found : err(CONTEXT_FOLDER_UNREADABLE);
};

/** Where a workspace's folder goes when it's archived. */
const archivedFolderOf = (contextDir: string, id: WorkspaceId) =>
  join(contextDir, ARCHIVED_FOLDER, id);

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

/** How many workspaces there are, archived ones too. */
export const countWorkspaces = async (
  contextDir: string,
): Promise<Result<number, WorkspaceError>> => {
  const current = await workspaceIds(contextDir);
  if (!current.ok) return current;
  const archivedFolder = join(contextDir, ARCHIVED_FOLDER);
  const hasArchived = await isWorkspaceFolder(archivedFolder);
  if (!hasArchived.ok) return hasArchived;
  const archived = hasArchived.value ? await workspaceIds(archivedFolder) : ok([]);
  return archived.ok ? ok(current.value.length + archived.value.length) : archived;
};

/** One workspace with its context file. */
export const getWorkspace = async (
  contextDir: string,
  id: string,
): Promise<Result<Workspace, WorkspaceError>> => {
  const parsed = workspaceIdFrom(id);
  if (parsed === undefined) return err({ kind: "not-found" });

  const folder = await isWorkspaceFolder(join(contextDir, parsed));
  if (!folder.ok) return folder;
  if (!folder.value) {
    const archived = await isWorkspaceFolder(archivedFolderOf(contextDir, parsed));
    if (!archived.ok) return archived;
    return err({ kind: archived.value ? "archived" : "not-found" });
  }
  const read = await readWorkspace(contextDir, parsed);
  if (!read.ok) return read;
  const [own] = withColours([read.value]);
  if (own?.colourKept) return ok(own.workspace);

  // Without a kept colour, a workspace's colour depends on which others have one.
  const every = await readEveryWorkspace(contextDir);
  if (!every.ok) return every;
  const listed = every.value.find((w) => w.workspace.summary.id === parsed);
  return listed ? ok(listed.workspace) : err({ kind: "not-found" });
};

/** Whether a workspace is archived: its folder is in the archived folder, not the context folder. */
export const isArchived = async (contextDir: string, id: WorkspaceId) => {
  const workspace = await getWorkspace(contextDir, id);
  return !workspace.ok && workspace.error.kind === "archived";
};

/** Keeps a name or colour in a workspace's config, alongside whatever else is there. */
const keepInConfig = async (
  workspace: Workspace,
  fields: { name?: string; colour?: WorkspaceColour },
): Promise<Result<null, WorkspaceError>> => {
  // Read as it is on disk, so fields the worker doesn't know about are kept too.
  const path = join(workspace.folder, CONFIG_FILE);
  const config = await readJsonFile(path, z.record(z.string(), z.unknown()));
  const written = config.ok ? await writeJsonFile(path, { ...config.value, ...fields }) : config;
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
    const kept = await keepInConfig(workspace, { colour: workspace.summary.colour });
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
  if (id.data === ARCHIVED_FOLDER) {
    return err({
      kind: "invalid",
      message: `"${ARCHIVED_FOLDER}" is where archived workspaces go. Choose another name.`,
    });
  }
  return ok(id.data);
};

/**
 * Why `name` can't be used, when another workspace already has it (or, for a new workspace, the
 * folder name `id`). Names that differ only in case or accents count as the same.
 */
const nameClash = (
  every: readonly Listed[],
  wanted: { name: string; id?: WorkspaceId; except?: WorkspaceId },
): WorkspaceError | undefined => {
  const clash = every.find(({ workspace: { summary } }) => {
    if (summary.id === wanted.except) return false;
    return summary.id === wanted.id || compareNames(summary.name, wanted.name) === 0;
  });
  return clash
    ? {
        kind: "conflict",
        message: `There's already a workspace called ${clash.workspace.summary.name}.`,
      }
    : undefined;
};

/**
 * Why a new workspace can't have the folder name `id`, when an archived one has it: its sessions
 * would turn up in the new one.
 */
const archivedClash = async (
  contextDir: string,
  id: WorkspaceId,
): Promise<WorkspaceError | undefined> => {
  const archived = await isWorkspaceFolder(archivedFolderOf(contextDir, id));
  if (!archived.ok) return archived.error;
  if (!archived.value) return undefined;
  const read = await readWorkspace(join(contextDir, ARCHIVED_FOLDER), id);
  const name = read.ok ? read.value.summary.name : id;
  return {
    kind: "conflict",
    message: `There's an archived workspace called ${name}. Move its folder out of the ${ARCHIVED_FOLDER} folder to bring it back, or choose another name.`,
  };
};

/** The colour the fewest workspaces have, earliest in the list on a tie. */
const nextColour = (every: readonly Listed[]) => {
  const uses = (colour: WorkspaceColour) =>
    every.filter((w) => w.workspace.summary.colour === colour).length;
  return COLOURS.reduce((fewest, colour) => (uses(colour) < uses(fewest) ? colour : fewest));
};

/**
 * A new workspace's context file: its title, its intro line (what it's for, when the owner said,
 * or else a line on how to fill it in), then empty Facts, Plans and Ideas (docs/ai-conduct.md,
 * "Starter context file").
 */
export const starterContextFile = (name: string, intro?: string) =>
  [
    `# ${name}`,
    "",
    intro ||
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
  starter: { name: string; intro: string | undefined; colour: WorkspaceColour },
): Promise<Result<null, WorkspaceError>> => {
  const problem: WorkspaceError = {
    kind: "storage",
    message: "The new workspace couldn't be saved.",
  };
  try {
    await writeFile(join(folder, CONTEXT_FILE), starterContextFile(starter.name, starter.intro), {
      flag: "wx",
    });
  } catch {
    return err(problem);
  }
  const config = { colour: starter.colour };
  const written = await writeJsonFile(join(folder, CONFIG_FILE), config, { exclusive: true });
  return written.ok ? ok(null) : err(problem);
};

/**
 * Adds a workspace called `name`: its folder, a starter context file starting with `intro` when
 * there is one, and the next colour, kept in its config. Refuses a name that can't be a folder
 * name or that another workspace has.
 */
export const createWorkspace = async (
  contextDir: string,
  { name, intro }: NewWorkspace,
): Promise<Result<WorkspaceSummary, WorkspaceError>> => {
  const id = folderNameFor(name);
  if (!id.ok) return id;
  const every = await readEveryWorkspace(contextDir);
  if (!every.ok) return every;
  const clash = nameClash(every.value, { name, id: id.value });
  if (clash) return err(clash);
  const archived = await archivedClash(contextDir, id.value);
  if (archived) return err(archived);

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

  const saved = await writeStarterFiles(folder, {
    name,
    intro,
    colour: nextColour(every.value),
  });
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
 * Gives a workspace a new name or colour, kept in its config. Its folder stays as it is, so its
 * sessions stay with it. Refuses a name another workspace has. A config that was ignored is left
 * for the owner to fix rather than overwritten.
 */
export const changeWorkspace = async (
  contextDir: string,
  change: { id: string; name?: string | undefined; colour?: WorkspaceColour | undefined },
): Promise<Result<WorkspaceSummary, WorkspaceError>> => {
  const every = await readEveryWorkspace(contextDir);
  if (!every.ok) return every;
  const listed = every.value.find((w) => w.workspace.summary.id === change.id);
  if (!listed) return err({ kind: "not-found" });
  const { summary } = listed.workspace;
  if (summary.configProblem !== undefined) {
    return err({ kind: "conflict", message: `${summary.configProblem} Fix it, then try again.` });
  }
  const { name, colour } = change;
  if (name !== undefined) {
    const clash = nameClash(every.value, { name, except: summary.id });
    if (clash) return err(clash);
  }

  if (colour !== undefined) {
    // Choosing a colour may change which others take turns, so theirs are kept first.
    const others = await keepColours(every.value.filter((w) => w !== listed));
    if (!others.ok) return others;
  }
  const fields = {
    ...(name === undefined ? {} : { name }),
    ...(colour === undefined ? {} : { colour }),
  };
  const kept = await keepInConfig(listed.workspace, fields);
  return kept.ok ? ok({ ...summary, ...fields }) : kept;
};

/**
 * Archives a workspace: its folder moves into the archived folder, so it leaves every list but
 * nothing in it is lost. Moving the folder back brings it back, sessions and all.
 */
export const archiveWorkspace = async (
  contextDir: string,
  id: string,
): Promise<Result<null, WorkspaceError>> => {
  const workspace = await getWorkspace(contextDir, id);
  if (!workspace.ok) return workspace;
  const { summary, folder } = workspace.value;
  const target = archivedFolderOf(contextDir, summary.id);
  const taken = await isWorkspaceFolder(target);
  if (!taken.ok) return taken;
  if (taken.value) {
    return err({
      kind: "conflict",
      message: `The ${ARCHIVED_FOLDER} folder already has a ${summary.id} folder. Rename one of them, then try again.`,
    });
  }
  try {
    await mkdir(join(contextDir, ARCHIVED_FOLDER), { recursive: true });
    await move(folder, target);
  } catch {
    return err({
      kind: "storage",
      message: `The ${summary.name} workspace couldn't be archived. Close anything that has its folder open, then try again.`,
    });
  }
  return ok(null);
};
