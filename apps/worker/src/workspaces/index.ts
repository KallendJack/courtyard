import type { Dirent } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  type ContextFile,
  WorkspaceId,
  type WorkspaceMode,
  type WorkspaceSummary,
} from "@courtyard/contract";
import { z } from "zod";
import { parseContextFile } from "../context/index.ts";
import { err, ok, type Result } from "../result.ts";

const CONTEXT_FILE = "CONTEXT.md";
const CONFIG_FILE = "workspace.json";

/** A workspace's optional `workspace.json`. Without one, a workspace is a planning workspace. */
const WorkspaceConfig = z
  .object({
    name: z.string().trim().min(1).optional(),
    mode: z.enum(["planning", "code"]).default("planning"),
    /** The git repository a code workspace works on, on the worker machine. */
    repoPath: z.string().min(1).optional(),
    /** Commands that run without an approval in a code workspace (ADR 0007). */
    allowedCommands: z.array(z.string().min(1)).default([]),
  })
  .refine((config) => config.mode !== "code" || config.repoPath !== undefined, {
    message: "is required for a code workspace",
    path: ["repoPath"],
  });

type Config = { name?: string; mode: WorkspaceMode; problem?: string };

const readOptional = async (path: string): Promise<string | undefined> => {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
};

const readConfig = async (folder: string): Promise<Config> => {
  const text = await readOptional(join(folder, CONFIG_FILE));
  if (text === undefined) return { mode: "planning" };

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { mode: "planning", problem: `${CONFIG_FILE} isn't valid JSON, so it was ignored.` };
  }

  const parsed = WorkspaceConfig.safeParse(json);
  if (!parsed.success) {
    const reasons = parsed.error.issues.map((i) => `${i.path.join(".") || "it"} ${i.message}`);
    return {
      mode: "planning",
      problem: `${CONFIG_FILE} was ignored: ${reasons.join("; ")}.`,
    };
  }
  return {
    mode: parsed.data.mode,
    ...(parsed.data.name === undefined ? {} : { name: parsed.data.name }),
  };
};

type Workspace = { summary: WorkspaceSummary; context: ContextFile | null };

const readWorkspace = async (contextDir: string, id: WorkspaceId): Promise<Workspace> => {
  const folder = join(contextDir, id);
  const [config, markdown] = await Promise.all([
    readConfig(folder),
    readOptional(join(folder, CONTEXT_FILE)),
  ]);
  const context = markdown === undefined ? null : parseContextFile(markdown);

  return {
    summary: {
      id,
      name: config.name ?? context?.title ?? id,
      mode: config.mode,
      hasContextFile: context !== null,
      ...(config.problem === undefined ? {} : { configProblem: config.problem }),
    },
    context,
  };
};

const byName = (a: WorkspaceSummary, b: WorkspaceSummary) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

/**
 * Every workspace in the context folder, by name. Folders whose names aren't workspace ids (such
 * as `.git`) and loose files are skipped.
 */
export const listWorkspaces = async (
  contextDir: string,
): Promise<Result<WorkspaceSummary[], string>> => {
  let entries: Dirent[];
  try {
    entries = await readdir(contextDir, { withFileTypes: true });
  } catch {
    return err("The context folder can't be read.");
  }

  const ids = entries.flatMap((entry) => {
    const id = WorkspaceId.safeParse(entry.name);
    return entry.isDirectory() && id.success ? [id.data] : [];
  });
  const workspaces = await Promise.all(ids.map((id) => readWorkspace(contextDir, id)));
  return ok(workspaces.map((w) => w.summary).sort(byName));
};

/** One workspace with its context file, or `undefined` when there's no such workspace. */
export const getWorkspace = async (
  contextDir: string,
  id: string,
): Promise<Workspace | undefined> => {
  const parsed = WorkspaceId.safeParse(id);
  if (!parsed.success) return undefined;
  const folder = await stat(join(contextDir, parsed.data)).catch(() => undefined);
  if (!folder?.isDirectory()) return undefined;
  return readWorkspace(contextDir, parsed.data);
};
