import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type ContextFile,
  type NewWorkspace,
  NotifyMe,
  SessionId,
  WorkspaceIcon,
  WorkspaceId,
  WorkspaceMode,
  type WorkspaceSummary,
} from "@courtyard/contract";
import { z } from "zod";
import {
  hasCode,
  isFolder,
  listSubfolders,
  move,
  readJsonFile,
  readTextFile,
  writeJsonFile,
} from "../../lib/files.ts";
import { err, ok, type Result } from "../../lib/result.ts";
import { parseContextFile } from "../context-file/index.ts";
import { suggestIcon } from "./icons.ts";

export const CONTEXT_FILE = "CONTEXT.md";
const CONFIG_FILE = "workspace.json";
/** Context folder folders that aren't workspaces, by what they hold: never listed, nor a name. */
export const ARCHIVED_FOLDER = "archived";
export const OWNER_THINGS_FOLDER = "things"; // The owner's tools (ADR 0037), as Things are kept.
const KEPT_FOLDERS: ReadonlyMap<string, string> = new Map([
  [ARCHIVED_FOLDER, "archived workspaces go"],
  [OWNER_THINGS_FOLDER, "the owner's tools are kept"],
]);

/** A command by its first words, one space apart, ending ` ...` if more may follow (`"git log ..."`). */
const CommandWords = z
  .string()
  .trim()
  .regex(/^\S+( \S+)*$/, "names a command by its words, one space apart")
  .refine((words) => words !== "...", "names no command");

/**
 * A command the owner allowed always in the workspace (#185), from an approval's Allow always: as
 * `CommandWords`, when, and from which session, by its title then. Kept in the workspace's own
 * settings, never in the repository's.
 */
const AllowedAlways = z.object({
  command: CommandWords,
  at: z.iso.datetime(),
  session: SessionId.optional(),
  title: z.string().optional(),
});
export type AllowedAlways = z.infer<typeof AllowedAlways>;

/**
 * A code workspace's changes to the default command allowlist (spec #169): the commands it adds,
 * and the default ones it removes, each as `CommandWords`, and those the owner allowed always
 * from an approval (#185).
 */
export const AllowlistSettings = z.object({
  add: z.array(CommandWords).default([]),
  remove: z.array(CommandWords).default([]),
  always: z.array(AllowedAlways).default([]),
});
export type AllowlistSettings = z.infer<typeof AllowlistSettings>;

/**
 * A code workspace's Paper connection (ADR 0023): Paper's command on the worker machine, which
 * runs its MCP server with `mcp`, and the one Paper file its sessions use, by its id (the last
 * part of the file's link in Paper).
 */
export const PaperSettings = z.object({
  command: z.string().trim().min(1),
  fileId: z.string().trim().min(1),
  /** The file's name in Paper, kept when it's connected from the workspace's page (#308). */
  name: z.string().trim().min(1).optional(),
});
export type PaperSettings = z.infer<typeof PaperSettings>;

/** A workspace's optional `workspace.json`. Without one, a workspace is a planning workspace. */
const WorkspaceConfig = z
  .object({
    name: z.string().trim().min(1).optional(),
    mode: z._default(WorkspaceMode, "planning"),
    /**
     * A code workspace's one line, What it's for (#301): it has no context file, so this is where
     * the line its page shows under its name lives.
     */
    description: z.string().trim().min(1).optional(),
    /** The git repository a code workspace works on, on the worker machine. */
    repoPath: z.string().min(1).optional(),
    /** A code workspace's changes to the default command allowlist, if any. */
    allowlist: AllowlistSettings.optional(),
    /** A code workspace's tool connections (ADR 0008): for now only Paper (ADR 0023). */
    connections: z.object({ paper: PaperSettings.optional() }).optional(),
    /** The command a code workspace's Start preview runs (#183), once the owner has confirmed it. */
    preview: z.string().trim().min(1).optional(),
    /** The icon the owner chose, or the one suggested when it was added (#210). */
    icon: z.optional(WorkspaceIcon),
    /** What it notifies the owner of (#493), once they've picked. */
    notify: NotifyMe.optional(),
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
      readonly description?: string;
      readonly icon?: WorkspaceIcon;
      readonly repoPath?: string;
      readonly allowlist?: AllowlistSettings;
      readonly paper?: PaperSettings;
      readonly preview?: string;
      readonly notify?: NotifyMe;
    }
  | { readonly kind: "ignored"; readonly problem: string };

export type Workspace = {
  readonly summary: WorkspaceSummary;
  /** Its context file: a planning workspace's; never a code workspace's, which has none (#301). */
  readonly contextFile: ContextFile | null;
  /** The workspace's folder on the worker machine. */
  readonly folder: string;
  /** The context file exactly as written, for models to read; never a code workspace's. */
  readonly contextMarkdown: string | null;
  /** A code workspace's one line, What it's for (#301), or `null` when it has none. */
  readonly description: string | null;
  /** A code workspace's repository on the worker machine, as its config names it. */
  readonly repoPath: string | null;
  /** A code workspace's changes to the default command allowlist: none when its config has none. */
  readonly allowlist: AllowlistSettings;
  /** A code workspace's Paper connection (ADR 0023), or `null` when its config names none. */
  readonly paper: PaperSettings | null;
  /** The command a code workspace's Start preview runs (#183), or `null` until the owner confirms one. */
  readonly preview: string | null;
  /**
   * What it notifies the owner of (#493): as they picked, else everything in a code workspace and
   * only what needs them in a planning one.
   */
  readonly notify: NotifyMe;
};

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
  const { name, mode, description, icon, repoPath, allowlist, connections, preview, notify } =
    parsed.data;
  return {
    kind: "read",
    mode,
    ...(notify === undefined ? {} : { notify }),
    ...(name === undefined ? {} : { name }),
    ...(description === undefined ? {} : { description }),
    ...(icon === undefined ? {} : { icon }),
    ...(repoPath === undefined ? {} : { repoPath }),
    ...(allowlist === undefined ? {} : { allowlist }),
    ...(connections?.paper === undefined ? {} : { paper: connections.paper }),
    ...(preview === undefined ? {} : { preview }),
  };
};

const readWorkspace = async (
  contextDir: string,
  id: WorkspaceId,
): Promise<Result<Workspace, WorkspaceError>> => {
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
  const read =
    markdown.value === undefined ? null : parseContextFile(withoutStarterHint(markdown.value));
  const valid = config.kind === "read" ? config : undefined;
  const name = valid?.name ?? read?.title ?? id;
  const mode = valid?.mode ?? "planning";
  // A code workspace has no context file (#301): one made before then is read only for the name
  // and the one line it held, until its workspace.json has them.
  const code = mode === "code";
  const contextFile = code ? null : read;
  const migrated = read?.intro ?? "";

  return ok({
    summary: {
      id,
      name,
      mode,
      // One made by hand, or before icons, shows the one its name suggests until the owner picks.
      icon: valid?.icon ?? suggestIcon(name, mode),
      ...(config.kind === "ignored" ? { configProblem: config.problem } : {}),
    },
    contextFile,
    folder,
    contextMarkdown: code ? null : (markdown.value ?? null),
    description: code ? (valid?.description ?? (migrated || null)) : null,
    repoPath: valid?.mode === "code" ? (valid.repoPath ?? null) : null,
    allowlist: valid?.allowlist ?? { add: [], remove: [], always: [] },
    paper: valid?.mode === "code" ? (valid.paper ?? null) : null,
    preview: valid?.mode === "code" ? (valid.preview ?? null) : null,
    notify: valid?.notify ?? (code ? "everything" : "needs-me"),
  });
};

/** A folder name as a workspace id, unless it can't be one (`.git`, or a kept folder). */
const workspaceIdFrom = (name: string): WorkspaceId | undefined => {
  const id = WorkspaceId.safeParse(name);
  return id.success && !KEPT_FOLDERS.has(id.data) ? id.data : undefined;
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

/** Every workspace in the context folder, in folder order. */
const readEveryWorkspace = async (
  contextDir: string,
): Promise<Result<Workspace[], WorkspaceError>> => {
  const ids = await workspaceIds(contextDir);
  if (!ids.ok) return ids;
  const workspaces: Workspace[] = [];
  for (const workspace of await Promise.all(ids.value.map((id) => readWorkspace(contextDir, id)))) {
    if (!workspace.ok) return workspace;
    workspaces.push(workspace.value);
  }
  return ok(workspaces);
};

/** Compares names the way the owner reads them: "Garage gym" and "garage Gym" are the same. */
const compareNames = (a: string, b: string) =>
  a.localeCompare(b, undefined, { sensitivity: "base" });

/**
 * The file at the context folder's top that keeps the owner's order for the workspaces (#321):
 * one list of ids for every device, so a workspace group (#105) can keep its own order by
 * following it too.
 */
export const ORDER_FILE = "workspace-order.json";

const OrderOnDisk = z.object({ order: z.array(z.string()) });

/** The saved order, by id: none when there is no order file, or it can't be read. */
const readOrder = async (contextDir: string): Promise<readonly string[]> => {
  const saved = await readJsonFile(join(contextDir, ORDER_FILE), OrderOnDisk);
  return saved.ok ? (saved.value?.order ?? []) : [];
};

/**
 * Planning workspaces first, then code ones, each group in the owner's order (`order`), and any
 * the order doesn't name at the end of their group, by name.
 */
const arranged = (summaries: WorkspaceSummary[], order: readonly string[]) => {
  const place = new Map(order.map((id, index) => [id, index]));
  const placeOf = (summary: WorkspaceSummary) => place.get(summary.id) ?? order.length;
  const group = (summary: WorkspaceSummary) => (summary.mode === "code" ? 1 : 0);
  return summaries.sort(
    (a, b) => group(a) - group(b) || placeOf(a) - placeOf(b) || compareNames(a.name, b.name),
  );
};

/** Every workspace in the context folder, planning ones then code ones, in the owner's order. */
export const listWorkspaces = async (
  contextDir: string,
): Promise<Result<WorkspaceSummary[], WorkspaceError>> => {
  const [every, order] = await Promise.all([readEveryWorkspace(contextDir), readOrder(contextDir)]);
  if (!every.ok) return every;
  return ok(
    arranged(
      every.value.map((workspace) => workspace.summary),
      order,
    ),
  );
};

/**
 * Keeps the owner's order for the workspaces (#321), as the rail or the sidebar left it, and
 * returns them in it. Refuses an order that names a workspace that isn't there, or puts a code
 * workspace among the planning ones (or the other way), so no device can mix the groups.
 */
export const arrangeWorkspaces = async (
  contextDir: string,
  order: readonly WorkspaceId[],
): Promise<Result<WorkspaceSummary[], WorkspaceError>> => {
  const every = await readEveryWorkspace(contextDir);
  if (!every.ok) return every;
  const modes = new Map(every.value.map(({ summary }) => [summary.id, summary.mode]));
  const named = order.map((id) => modes.get(id));
  if (named.includes(undefined)) return err({ kind: "not-found" });
  if (named.indexOf("code") !== -1 && named.lastIndexOf("planning") > named.indexOf("code")) {
    return err({
      kind: "invalid",
      message: "Planning and code workspaces each keep their own group: put the code ones last.",
    });
  }
  const written = await writeJsonFile(join(contextDir, ORDER_FILE), { order });
  if (!written.ok) return err({ kind: "storage", message: "The order can't be saved." });
  return listWorkspaces(contextDir);
};

/** Every code workspace in the context folder, with the repository it works on (#258). */
export const listCodeWorkspaces = async (
  contextDir: string,
): Promise<Result<{ summary: WorkspaceSummary; repoPath: string }[], WorkspaceError>> => {
  const every = await readEveryWorkspace(contextDir);
  if (!every.ok) return every;
  return ok(
    every.value.flatMap(({ summary, repoPath }) =>
      repoPath === null ? [] : [{ summary, repoPath }],
    ),
  );
};

/**
 * Paper's command on the worker machine, as the first code workspace that names Paper has it
 * (ADR 0023), for connecting Paper in another (#308); `undefined` when none does.
 */
export const paperCommandInUse = async (contextDir: string) => {
  const every = await readEveryWorkspace(contextDir);
  return every.ok ? every.value.find((workspace) => workspace.paper)?.paper?.command : undefined;
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
  return readWorkspace(contextDir, parsed);
};

/** Whether a workspace is archived: its folder is in the archived folder, not the context folder. */
export const isArchived = async (contextDir: string, id: WorkspaceId) => {
  const workspace = await getWorkspace(contextDir, id);
  return !workspace.ok && workspace.error.kind === "archived";
};

const ConfigOnDisk = z.record(z.string(), z.unknown());

/**
 * Keeps fields in a workspace's config, alongside whatever else is there: a name or icon, or
 * what `change` makes of the config as it is on disk.
 */
const keepInConfig = async (
  workspace: Workspace,
  fields:
    | { name?: string; icon?: WorkspaceIcon }
    | ((config: Readonly<Record<string, unknown>>) => Record<string, unknown>),
): Promise<Result<null, WorkspaceError>> => {
  // Read as it is on disk, so fields the worker doesn't know about are kept too.
  const path = join(workspace.folder, CONFIG_FILE);
  const config = await readJsonFile(path, ConfigOnDisk);
  const written = config.ok
    ? await writeJsonFile(path, {
        ...config.value,
        ...(typeof fields === "function" ? fields(config.value ?? {}) : fields),
      })
    : config;
  return written.ok
    ? ok(null)
    : err({
        kind: "storage",
        message: `The ${workspace.summary.id} workspace's ${CONFIG_FILE} can't be saved.`,
      });
};

/** Names Windows keeps for devices, which can't be folder or file names there. */
export const RESERVED_ON_WINDOWS = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/;

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
 * A name as a file or folder name: its letters and digits, lowercase and without accents, with a
 * dash between words. "Nan's 80th Birthday!" is `nans-80th-birthday`; empty when it has none.
 */
export const plainName = (name: string) =>
  name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[ßæœøđłþ]/g, (letter) => PLAIN_LETTERS[letter] ?? letter)
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/** The folder name for a workspace called `name` (see `plainName`). */
const folderNameFor = (name: string): Result<WorkspaceId, WorkspaceError> => {
  const id = WorkspaceId.safeParse(plainName(name));
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
  const kept = KEPT_FOLDERS.get(id.data);
  if (kept) {
    return err({ kind: "invalid", message: `"${id.data}" is where ${kept}. Choose another name.` });
  }
  return ok(id.data);
};

/**
 * Why `name` can't be used, when another workspace already has it (or, for a new workspace, the
 * folder name `id`). Names that differ only in case or accents count as the same.
 */
const nameClash = (
  every: readonly Workspace[],
  wanted: { name: string; id?: WorkspaceId; except?: WorkspaceId },
): WorkspaceError | undefined => {
  const clash = every.find(({ summary }) => {
    if (summary.id === wanted.except) return false;
    return summary.id === wanted.id || compareNames(summary.name, wanted.name) === 0;
  });
  return clash
    ? {
        kind: "conflict",
        message: `There's already a workspace called ${clash.summary.name}.`,
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

/**
 * The hint the starter once wrote where the intro line goes when the owner didn't say what the
 * workspace is for. It's never written now, and a file still holding it reads as having no intro
 * line, so no model takes it for what the workspace is for (#300).
 */
const OLD_STARTER_HINT =
  "Write one line for each fact, plan or idea. Facts are true now, plans are decided but not done, and ideas are being considered.";

/** A context file as models read it: without the old starter hint (#300). */
export const withoutStarterHint = (markdown: string) => {
  const lines = markdown.split("\n");
  const at = lines.findIndex((line) => line.trim() === OLD_STARTER_HINT);
  if (at === -1) return markdown;
  // The blank line after it goes too, so the title keeps one blank line below it.
  const blankAfter = lines[at + 1]?.trim() === "" ? 1 : 0;
  lines.splice(at, 1 + blankAfter);
  return lines.join("\n");
};

/**
 * A new workspace's context file: its title, its intro line (what it's for, when the owner said;
 * none otherwise), then empty Facts and Ideas (docs/ai-conduct.md, "Starter context file").
 */
export const starterContextFile = (name: string, intro?: string) =>
  [`# ${name}`, "", ...(intro ? [intro, ""] : []), "## Facts", "", "## Ideas", ""].join("\n");

/**
 * Writes a new workspace's files into its empty folder: a planning workspace's context file and
 * config; a code workspace's config alone, naming its repository and holding its name and one line
 * (README, Code workspaces; #301), since it has no context file.
 */
const writeStarterFiles = async (
  folder: string,
  starter: {
    name: string;
    intro: string | undefined;
    icon: WorkspaceIcon;
    repoPath: string | undefined;
  },
): Promise<Result<null, WorkspaceError>> => {
  const problem: WorkspaceError = {
    kind: "storage",
    message: "The new workspace couldn't be saved.",
  };
  if (starter.repoPath === undefined) {
    try {
      await writeFile(join(folder, CONTEXT_FILE), starterContextFile(starter.name, starter.intro), {
        flag: "wx",
      });
    } catch {
      return err(problem);
    }
  }
  const config =
    starter.repoPath === undefined
      ? { icon: starter.icon }
      : {
          name: starter.name,
          mode: "code",
          repoPath: starter.repoPath,
          ...(starter.intro ? { description: starter.intro } : {}),
          icon: starter.icon,
        };
  const written = await writeJsonFile(join(folder, CONFIG_FILE), config, { exclusive: true });
  return written.ok ? ok(null) : err(problem);
};

/**
 * Whether a workspace called `name` can be added: the folder name it would have, or why not (a
 * name that can't be a folder name, or that another workspace, archived or not, has).
 */
export const checkNewName = async (
  contextDir: string,
  name: string,
): Promise<Result<WorkspaceId, WorkspaceError>> => {
  const id = folderNameFor(name);
  if (!id.ok) return id;
  const every = await readEveryWorkspace(contextDir);
  if (!every.ok) return every;
  const clash = nameClash(every.value, { name, id: id.value });
  if (clash) return err(clash);
  const archived = await archivedClash(contextDir, id.value);
  return archived ? err(archived) : id;
};

/**
 * Adds a workspace called `name`: its folder, a starter context file starting with `intro` when
 * there is one, and the icon its name suggests, kept in its config. With `repoPath`, it's a code
 * workspace on that repository (#258), with no context file: `intro` is its config's description
 * (#301). Refuses a name that can't be a folder name or that another workspace has.
 */
export const createWorkspace = async (
  contextDir: string,
  { name, intro, repoPath }: Pick<NewWorkspace, "name" | "intro"> & { readonly repoPath?: string },
): Promise<Result<WorkspaceSummary, WorkspaceError>> => {
  const id = await checkNewName(contextDir, name);
  if (!id.ok) return id;

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
    icon: suggestIcon(name, repoPath === undefined ? "planning" : "code"),
    repoPath,
  });
  if (!saved.ok) {
    // Half a workspace would just confuse things later.
    await rm(folder, { recursive: true, force: true }).catch(() => undefined);
    return saved;
  }

  const created = await getWorkspace(contextDir, id.value);
  return created.ok ? ok(created.value.summary) : created;
};

/**
 * Gives a workspace a new name or icon, kept in its config. Its folder stays as it is, so its
 * sessions stay with it. Refuses a name another workspace has. A config that was ignored is left
 * for the owner to fix rather than overwritten.
 */
export const changeWorkspace = async (
  contextDir: string,
  change: { id: string; name?: string | undefined; icon?: WorkspaceIcon | undefined },
): Promise<Result<WorkspaceSummary, WorkspaceError>> => {
  const every = await readEveryWorkspace(contextDir);
  if (!every.ok) return every;
  const listed = every.value.find((w) => w.summary.id === change.id);
  if (!listed) return err({ kind: "not-found" });
  const { summary } = listed;
  if (summary.configProblem !== undefined) {
    return err({ kind: "conflict", message: `${summary.configProblem} Fix it, then try again.` });
  }
  const { name, icon } = change;
  if (name !== undefined) {
    const clash = nameClash(every.value, { name, except: summary.id });
    if (clash) return err(clash);
  }

  const kept = await keepInConfig(listed, {
    ...(name === undefined ? {} : { name }),
    ...(icon === undefined ? {} : { icon }),
  });
  if (!kept.ok) return kept;
  // Read again: a new name can suggest another icon, when the owner hasn't picked one.
  const changed = await readWorkspace(contextDir, summary.id);
  return changed.ok ? ok(changed.value.summary) : changed;
};

/**
 * Connects a code workspace's one Paper file (ADR 0023, #308), kept in its config's connections
 * beside anything else there, replacing the file it had. Refuses a planning workspace, and a config
 * that was ignored, which is left for the owner to fix.
 */
export const connectPaper = async (
  contextDir: string,
  connect: { id: string; paper: PaperSettings },
): Promise<Result<Workspace, WorkspaceError>> => {
  const workspace = await getWorkspace(contextDir, connect.id);
  if (!workspace.ok) return workspace;
  const { summary } = workspace.value;
  if (summary.configProblem !== undefined) {
    return err({ kind: "conflict", message: `${summary.configProblem} Fix it, then try again.` });
  }
  if (summary.mode !== "code") {
    return err({ kind: "invalid", message: "Only a code workspace connects Paper." });
  }
  const kept = await keepInConfig(workspace.value, (config) => {
    const connections = ConfigOnDisk.safeParse(config.connections);
    return {
      connections: { ...(connections.success ? connections.data : {}), paper: connect.paper },
    };
  });
  if (!kept.ok) return kept;
  return readWorkspace(contextDir, summary.id);
};

/**
 * Keeps the command a code workspace's Start preview runs (#183), once the owner has confirmed it,
 * in its config beside anything else there. Refuses a planning workspace, and a config that was
 * ignored, which is left for the owner to fix.
 */
export const keepPreviewCommand = async (
  contextDir: string,
  keep: { id: string; command: string },
): Promise<Result<Workspace, WorkspaceError>> => {
  const workspace = await getWorkspace(contextDir, keep.id);
  if (!workspace.ok) return workspace;
  const { summary } = workspace.value;
  if (summary.configProblem !== undefined) {
    return err({ kind: "conflict", message: `${summary.configProblem} Fix it, then try again.` });
  }
  if (summary.mode !== "code") {
    return err({ kind: "invalid", message: "Only a code workspace previews its app." });
  }
  const kept = await keepInConfig(workspace.value, () => ({ preview: keep.command }));
  if (!kept.ok) return kept;
  return readWorkspace(contextDir, summary.id);
};

/**
 * Changes the commands a code workspace's owner allowed always (#185), kept in its config's
 * allowlist beside whatever else is there: `change` makes the new list of what was allowed from
 * the one on disk, whose entries it can't read kept as they are. Refuses a planning workspace, and
 * a config that was ignored, which is left for the owner to fix.
 */
const changeAllowedAlways = async (
  contextDir: string,
  id: string,
  change: (
    allowed: readonly { readonly entry: unknown; readonly read: AllowedAlways | undefined }[],
  ) => readonly unknown[],
): Promise<Result<Workspace, WorkspaceError>> => {
  const workspace = await getWorkspace(contextDir, id);
  if (!workspace.ok) return workspace;
  const { summary } = workspace.value;
  if (summary.configProblem !== undefined) {
    return err({ kind: "conflict", message: `${summary.configProblem} Fix it, then try again.` });
  }
  if (summary.mode !== "code") {
    return err({ kind: "invalid", message: "Only a code workspace allows commands." });
  }
  const kept = await keepInConfig(workspace.value, (config) => {
    const allowlist = ConfigOnDisk.safeParse(config.allowlist);
    const was = allowlist.success ? allowlist.data : {};
    const always = z.array(z.unknown()).safeParse(was.always);
    const entries = (always.success ? always.data : []).map((entry) => {
      const read = AllowedAlways.safeParse(entry);
      return { entry, read: read.success ? read.data : undefined };
    });
    return { allowlist: { ...was, always: change(entries) } };
  });
  if (!kept.ok) return kept;
  return readWorkspace(contextDir, summary.id);
};

/**
 * Allows a command always in a code workspace (#185), from an approval's Allow always, by its
 * `CommandWords`: kept in its config, where its sessions' turns read it from then on. One already
 * allowed keeps when it was first.
 */
export const allowAlways = (
  contextDir: string,
  allowing: { id: string; allowed: AllowedAlways },
): Promise<Result<Workspace, WorkspaceError>> =>
  changeAllowedAlways(contextDir, allowing.id, (entries) =>
    entries.some(({ read }) => read?.command === allowing.allowed.command)
      ? entries.map(({ entry }) => entry)
      : [...entries.map(({ entry }) => entry), allowing.allowed],
  );

/**
 * Removes a command the owner allowed always in a code workspace (#185), by its `CommandWords`,
 * so its sessions ask for it again. One that isn't there is already removed.
 */
export const removeAllowed = (
  contextDir: string,
  removing: { id: string; command: string },
): Promise<Result<Workspace, WorkspaceError>> =>
  changeAllowedAlways(contextDir, removing.id, (entries) =>
    entries.flatMap(({ entry, read }) => (read?.command === removing.command ? [] : [entry])),
  );

/**
 * Keeps what a workspace notifies the owner of (#493), from its Notify me, in its config beside
 * whatever else is there. Refuses a config that was ignored, which is left for the owner to fix.
 */
export const keepNotify = async (
  contextDir: string,
  keep: { id: string; notify: NotifyMe },
): Promise<Result<Workspace, WorkspaceError>> => {
  const workspace = await getWorkspace(contextDir, keep.id);
  if (!workspace.ok) return workspace;
  const { summary } = workspace.value;
  if (summary.configProblem !== undefined) {
    return err({ kind: "conflict", message: `${summary.configProblem} Fix it, then try again.` });
  }
  const kept = await keepInConfig(workspace.value, () => ({ notify: keep.notify }));
  if (!kept.ok) return kept;
  return readWorkspace(contextDir, summary.id);
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
