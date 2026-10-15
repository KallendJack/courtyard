import type {
  PaperConnecting,
  PaperFile,
  SetupPaper,
  WorkspaceConnections,
} from "@courtyard/contract";
import { type ContextFolder, workspaceChange } from "../../context/context-folder/index.ts";
import {
  connectPaper,
  getWorkspace,
  paperCommandInUse,
  type Workspace,
  type WorkspaceError,
} from "../../context/workspaces/index.ts";
import type { Code } from "../../devflow/code/index.ts";
import type { GitHub } from "../../devflow/github/index.ts";
import { err, ok, type Result } from "../../result.ts";
import type { PaperFiles } from "../paper/files.ts";

/**
 * A code workspace's connections (#308): GitHub, through Courtyard's sign-in (#99), and its one
 * Paper file (ADR 0023). What its page's connections line and Connections sheet show, connecting
 * Paper from there, and what each of its turns is told it has.
 */

/** Why a workspace's connections couldn't be shown or changed. */
export type ConnectionsProblem =
  | { readonly kind: "workspace"; readonly error: WorkspaceError }
  /** It isn't a code workspace: only those have connections yet. */
  | { readonly kind: "not-code" }
  /** Courtyard doesn't know where Paper is on the worker machine. */
  | { readonly kind: "no-paper-command" }
  /** Paper couldn't be asked (it isn't open, say), in the owner's words. */
  | { readonly kind: "paper"; readonly message: string };

export const createConnections = (options: {
  contextDir: string;
  contextFolder: ContextFolder;
  github: Pick<GitHub, "signedIn">;
  code: Pick<Code, "onGitHub">;
  paperFiles: PaperFiles;
  /** Paper's command from the worker's settings, when the owner set one. */
  paperCommand: string | null;
}) => {
  const { contextDir } = options;

  /** A code workspace, or why it has no connections. */
  const codeWorkspace = async (rawId: string): Promise<Result<Workspace, ConnectionsProblem>> => {
    const workspace = await getWorkspace(contextDir, rawId);
    if (!workspace.ok) return err({ kind: "workspace", error: workspace.error });
    return workspace.value.summary.mode === "code" && workspace.value.repoPath !== null
      ? workspace
      : err({ kind: "not-code" });
  };

  /** A code workspace's connections, as they are now. */
  const of = async (workspace: Workspace): Promise<WorkspaceConnections> => {
    const repo =
      workspace.repoPath === null ? undefined : await options.code.onGitHub(workspace.repoPath);
    const signedIn = await options.github.signedIn();
    const { paper } = workspace;
    return {
      github:
        repo === undefined || !repo.ok
          ? { kind: "not-on-github" }
          : signedIn
            ? { kind: "connected", repo: repo.value }
            : { kind: "signed-out", repo: repo.value },
      paper:
        paper === null
          ? { kind: "none" }
          : {
              kind: "connected",
              fileId: paper.fileId,
              ...(paper.name === undefined ? {} : { name: paper.name }),
            },
    };
  };

  /**
   * Paper's command for a workspace: its own, else the worker's setting, else the one another code
   * workspace names; or why there's none.
   */
  const paperCommandFor = async (
    workspace: Workspace | undefined,
  ): Promise<Result<string, ConnectionsProblem>> => {
    const command =
      workspace?.paper?.command ?? options.paperCommand ?? (await paperCommandInUse(contextDir));
    return command === undefined ? err({ kind: "no-paper-command" }) : ok(command);
  };

  return {
    of,

    get: async (rawId: string): Promise<Result<WorkspaceConnections, ConnectionsProblem>> => {
      const workspace = await codeWorkspace(rawId);
      return workspace.ok ? ok(await of(workspace.value)) : workspace;
    },

    /**
     * Whether Courtyard can make a code workspace its Paper file (#323's setup card): it has none
     * yet, and Courtyard knows where Paper is.
     */
    canMakePaper: async (rawId: string): Promise<boolean> => {
      const workspace = await codeWorkspace(rawId);
      return (
        workspace.ok &&
        workspace.value.paper === null &&
        (await paperCommandFor(workspace.value)).ok
      );
    },

    /** Whether Courtyard knows where Paper is, so it can make a new workspace a file (#391). */
    canMakeNewPaper: async (): Promise<boolean> => (await paperCommandFor(undefined)).ok,

    /** The owner's Paper files, for the Connections sheet to pick from. */
    paperFiles: async (
      rawId: string,
    ): Promise<Result<readonly PaperFile[], ConnectionsProblem>> => {
      const workspace = await codeWorkspace(rawId);
      if (!workspace.ok) return workspace;
      const command = await paperCommandFor(workspace.value);
      if (!command.ok) return command;
      const files = await options.paperFiles.list(command.value);
      return files.ok ? files : err({ kind: "paper", message: files.error });
    },

    /**
     * Connects the workspace's one Paper file (ADR 0023): one picked, or a new one made in Paper
     * first. Kept in its `workspace.json` as one change, replacing any file it had.
     */
    connectPaper: async (
      rawId: string,
      connecting: PaperConnecting,
    ): Promise<Result<WorkspaceConnections, ConnectionsProblem>> => {
      const workspace = await codeWorkspace(rawId);
      if (!workspace.ok) return workspace;
      const command = await paperCommandFor(workspace.value);
      if (!command.ok) return command;
      let file: PaperFile;
      if (connecting.kind === "file") {
        file = connecting.file;
      } else {
        const made = await options.paperFiles.create(command.value, connecting.name);
        if (!made.ok) return err({ kind: "paper", message: made.error });
        file = made.value;
      }
      const { id, name } = workspace.value.summary;
      const connected = await options.contextFolder.change(
        () =>
          connectPaper(contextDir, {
            id,
            paper: { command: command.value, fileId: file.id, name: file.name },
          }),
        () => workspaceChange(`Connect Paper to ${name}: ${file.name}`, id),
      );
      if (!connected.ok) return err({ kind: "workspace", error: connected.error });
      return ok(await of(connected.value));
    },
  };
};

/**
 * Makes a code workspace a new Paper file named `name` and connects it (#323, #391), saying what
 * happened in the owner's words: it's optional, so a Paper that can't be reached fails only it.
 */
export const makePaperFile = async (
  connections: Pick<Connections, "connectPaper">,
  workspaceId: string,
  name: string,
): Promise<SetupPaper> => {
  const made = await connections.connectPaper(workspaceId, { kind: "new", name });
  if (made.ok) return { kind: "made", name };
  return {
    kind: "failed",
    reason: made.error.kind === "paper" ? made.error.message : "Paper couldn't be reached.",
  };
};

export type Connections = ReturnType<typeof createConnections>;
