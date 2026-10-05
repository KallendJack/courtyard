import type { Dirent } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  type ContextFile,
  WorkspaceId,
  WorkspaceMode,
  type WorkspaceSummary,
} from "@courtyard/contract";
import { z } from "zod";
import { parseContextFile } from "../context-file/index.ts";
import { hasCode } from "../files.ts";
import { err, ok, type Result } from "../result.ts";

const CONTEXT_FILE = "CONTEXT.md";
const CONFIG_FILE = "workspace.json";

/** A workspace's optional `workspace.json`. Without one, a workspace is a planning workspace. */
const WorkspaceConfig = z
  .object({
    name: z.string().trim().min(1).optional(),
    mode: WorkspaceMode.default("planning"),
    /** The git repository a code workspace works on, on the worker machine. */
    repoPath: z.string().min(1).optional(),
  })
  .refine((config) => config.mode !== "code" || config.repoPath !== undefined, {
    message: "is required for a code workspace",
    path: ["repoPath"],
  });

type Config =
  | { readonly kind: "absent" }
  | { readonly kind: "read"; readonly name?: string; readonly mode: WorkspaceMode }
  | { readonly kind: "ignored"; readonly problem: string };

type Workspace = { readonly summary: WorkspaceSummary; readonly contextFile: ContextFile | null };

/** Why a workspace couldn't be read. */
export type WorkspaceError =
  | { readonly kind: "not-found" }
  | { readonly kind: "unreadable"; readonly message: string };

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
  const { name, mode } = parsed.data;
  return { kind: "read", mode, ...(name === undefined ? {} : { name }) };
};

const readWorkspace = async (
  contextDir: string,
  id: WorkspaceId,
): Promise<Result<Workspace, WorkspaceError>> => {
  const folder = join(contextDir, id);
  const [config, markdown] = await Promise.all([
    readConfig(folder),
    readIfPresent(join(folder, CONTEXT_FILE)),
  ]);
  if (!markdown.ok) {
    return err({
      kind: "unreadable",
      message: `The ${id} workspace's ${CONTEXT_FILE} can't be read.`,
    });
  }
  const contextFile = markdown.value === undefined ? null : parseContextFile(markdown.value);
  const configName = config.kind === "read" ? config.name : undefined;

  return ok({
    summary: {
      id,
      name: configName ?? contextFile?.title ?? id,
      mode: config.kind === "read" ? config.mode : "planning",
      hasContextFile: contextFile !== null,
      ...(config.kind === "ignored" ? { configProblem: config.problem } : {}),
    },
    contextFile,
  });
};

const byName = (a: WorkspaceSummary, b: WorkspaceSummary) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

/**
 * Every workspace in the context folder, by name. Folders whose names aren't workspace ids (such
 * as `.git`) and loose files are skipped.
 */
export const listWorkspaces = async (
  contextDir: string,
): Promise<Result<WorkspaceSummary[], WorkspaceError>> => {
  let entries: Dirent[];
  try {
    entries = await readdir(contextDir, { withFileTypes: true });
  } catch {
    return err({ kind: "unreadable", message: "The context folder can't be read." });
  }

  const ids = entries.flatMap((entry) => {
    const id = WorkspaceId.safeParse(entry.name);
    return entry.isDirectory() && id.success ? [id.data] : [];
  });
  const summaries: WorkspaceSummary[] = [];
  for (const workspace of await Promise.all(ids.map((id) => readWorkspace(contextDir, id)))) {
    if (!workspace.ok) return workspace;
    summaries.push(workspace.value.summary);
  }
  return ok(summaries.sort(byName));
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
    if (!hasCode(error, "ENOENT"))
      return err({ kind: "unreadable", message: "The context folder can't be read." });
  }
  if (!folder?.isDirectory()) return err({ kind: "not-found" });
  return readWorkspace(contextDir, parsed.data);
};
