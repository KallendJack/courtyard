import { join } from "node:path";
import {
  PREVIEW_SIZES,
  type Preview,
  PreviewSize,
  type SessionId,
  type TaskId,
} from "@courtyard/contract";
import { z } from "zod";
import { exists, readJsonFile } from "../../lib/files.ts";
import type { CommandEnv } from "../../lib/git.ts";
import { err, ok, type Result } from "../../lib/result.ts";
import { previewToolReply } from "../../prompts/index.ts";
import type { ToolReply } from "../../providers/index.ts";
import { type ContextFolder, workspaceChange } from "../context-folder/index.ts";
import type { SessionError, Sessions } from "../sessions/index.ts";
import { getWorkspace, keepPreviewCommand, type WorkspaceError } from "../workspaces/index.ts";
import { freePort, openPreviewPort, type PreviewPort } from "./proxy.ts";
import { type Screenshot, takeScreenshot } from "./screenshot.ts";

/**
 * Code sessions' previews (#183): a task serving a web page, reached through a port of the
 * worker's own (one of `COURTYARD_PREVIEW_PORTS`), behind the owner's login, only while the task
 * runs. The app itself stays on the worker machine's localhost.
 */

/** A terminal's colour codes, which start with the escape character. */
const COLOURS = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

/**
 * Where a task's output says it serves: the first `http://localhost:<port>` it prints, as Vite,
 * Next and most dev servers do, its colours taken out first (Vite prints the port in bold).
 */
export const servingPortIn = (output: string) => {
  const plain = output.replace(COLOURS, "");
  const [, port] =
    /https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):(\d{2,5})(?![\d])/.exec(plain) ?? [];
  const number = Number(port);
  return port === undefined || number < 1 || number > 65535 ? undefined : number;
};

const PackageScripts = z.object({ scripts: z.record(z.string(), z.unknown()).optional() });

/** Each package manager, by the lockfile that says a repository uses it, and how it runs a script. */
const RUNNERS = [
  { lockfile: "pnpm-lock.yaml", run: (script: string) => `pnpm ${script}` },
  { lockfile: "yarn.lock", run: (script: string) => `yarn ${script}` },
  { lockfile: "bun.lock", run: (script: string) => `bun run ${script}` },
  { lockfile: "bun.lockb", run: (script: string) => `bun run ${script}` },
] as const;

/**
 * The command Courtyard fills in for Start preview, from the repository's scripts in `worktree`:
 * its `preview:session` script when it has one (a repository whose `dev` isn't for previewing,
 * Courtyard's own), else its `dev` script, run by the package manager its lockfile names (npm
 * without one); `null` when it has neither.
 */
const suggestedCommand = async (worktree: string) => {
  const read = await readJsonFile(join(worktree, "package.json"), PackageScripts);
  const scripts = read.ok ? (read.value?.scripts ?? {}) : {};
  const script = ["preview:session", "dev"].find((name) => typeof scripts[name] === "string");
  if (script === undefined) return null;
  for (const runner of RUNNERS) {
    const found = await exists(join(worktree, runner.lockfile));
    if (found.ok && found.value) return runner.run(script);
  }
  return `npm run ${script}`;
};

/** Why a preview couldn't be shown or started. */
export type PreviewError =
  | { readonly kind: "session"; readonly error: SessionError }
  | { readonly kind: "workspace"; readonly error: WorkspaceError }
  /** The session previews already: its Preview shows. */
  | { readonly kind: "previewing" };

/** A preview open on one of the worker's ports, in front of the task serving it. */
type Open = { readonly session: SessionId; readonly app: number; readonly port: PreviewPort };

export const createPreviews = (options: {
  /** The ports previews are reached on; `[0]` for any free one. */
  ports: readonly number[];
  /** Whether a request's `Cookie` header is the owner's, logged in. */
  loggedIn: (cookies: string | undefined) => Promise<boolean>;
  sessions: Sessions;
  contextDir: string;
  contextFolder: ContextFolder;
  /** The environment a session's commands get (Courtyard's GitHub sign-in), which Start preview's gets too. */
  commandEnv: () => Promise<CommandEnv>;
  /** Takes a screenshot of a page of the app. Tests pass their own; otherwise Chromium does. */
  screenshot?: Screenshot;
}) => {
  const screenshot = options.screenshot ?? takeScreenshot;
  /** Each task's preview while it's open, by the task. */
  const open = new Map<TaskId, Open>();
  /** The task each opening preview's port is for, while it opens, so two asks open one. */
  const opening = new Map<TaskId, Promise<Open | undefined>>();

  /** Opens a task's preview on a port no other preview uses, unless every one is in use. */
  const openFor = (session: SessionId, task: TaskId, app: number) => {
    const already = open.get(task);
    if (already !== undefined) return Promise.resolve(already);
    const waiting = opening.get(task);
    if (waiting !== undefined) return waiting;
    const made = (async () => {
      const taken = new Set([...open.values()].map((each) => each.port.port));
      const port = await openPreviewPort({
        ports: options.ports.filter((each) => each === 0 || !taken.has(each)),
        app,
        loggedIn: options.loggedIn,
      });
      opening.delete(task);
      if (port === undefined) return undefined;
      const opened: Open = { session, app, port };
      open.set(task, opened);
      return opened;
    })();
    opening.set(task, made);
    return made;
  };

  /**
   * The session's preview: the first of its running tasks whose output says where it serves,
   * opened on a port of its own; and its worktree and workspace, for Start preview.
   */
  const find = async (rawId: string) => {
    const listed = await options.sessions.previewTasks(rawId);
    if (!listed.ok) return listed;
    const { id, tasks } = listed.value;
    for (const { task, opening: output } of tasks) {
      const app = open.get(task)?.app ?? servingPortIn(output);
      if (app === undefined) continue;
      const opened = await openFor(id, task, app);
      return ok({ listed: listed.value, task, opened });
    }
    return ok({ listed: listed.value, task: undefined, opened: undefined });
  };

  return {
    /** A code session's preview, as its page shows it. */
    of: async (rawId: string): Promise<Result<Preview, PreviewError>> => {
      const found = await find(rawId);
      if (!found.ok) return err({ kind: "session", error: found.error });
      const { listed, task, opened } = found.value;
      if (task !== undefined) {
        return ok(
          opened === undefined
            ? { kind: "full", task }
            : { kind: "serving", task, port: opened.port.port },
        );
      }
      const starting = listed.tasks.find((each) => each.preview);
      if (starting !== undefined) return ok({ kind: "starting", task: starting.task });
      const workspace = await getWorkspace(options.contextDir, listed.workspaceId);
      if (!workspace.ok) return err({ kind: "workspace", error: workspace.error });
      const kept = workspace.value.preview;
      return ok(
        kept === null
          ? { kind: "none", command: await suggestedCommand(listed.worktree), confirmed: false }
          : { kind: "none", command: kept, confirmed: true },
      );
    },

    /**
     * Start preview: runs the owner's command as one of the session's tasks, with `PORT` set to a
     * free port for it to serve on, and keeps the command as the workspace's, once it differs from
     * the one kept.
     */
    start: async (rawId: string, command: string): Promise<Result<TaskId, PreviewError>> => {
      const found = await find(rawId);
      if (!found.ok) return err({ kind: "session", error: found.error });
      const { listed, task } = found.value;
      if (task !== undefined || listed.tasks.some((each) => each.preview)) {
        return err({ kind: "previewing" });
      }
      const workspace = await getWorkspace(options.contextDir, listed.workspaceId);
      if (!workspace.ok) return err({ kind: "workspace", error: workspace.error });
      if (workspace.value.preview !== command) {
        const kept = await options.contextFolder.change(
          () => keepPreviewCommand(options.contextDir, { id: listed.workspaceId, command }),
          (made) => workspaceChange(`Preview with ${command}`, made.summary.id),
        );
        if (!kept.ok) return err({ kind: "workspace", error: kept.error });
      }
      const started = await options.sessions.startPreview({
        id: listed.id,
        command,
        env: { ...(await options.commandEnv()), PORT: String(await freePort()) },
      });
      return started.ok ? started : err({ kind: "session", error: started.error });
    },

    /** A task has ended: its preview, if it had one, closes. */
    ended: (_session: SessionId, task: TaskId) => {
      const opened = open.get(task);
      open.delete(task);
      opened?.port.close();
    },

    /**
     * The model's `preview_screenshot` (#183): a page of the session's preview at one of the
     * sizes, taken on the worker machine as the owner sees it, logged in as they are there.
     */
    tool: async (session: SessionId, input: unknown): Promise<ToolReply> => {
      const asked = ScreenshotInput.safeParse(input);
      if (!asked.success) return previewToolReply({ kind: "malformed" });
      const found = await find(session);
      const opened = found.ok ? found.value.opened : undefined;
      if (opened === undefined) return previewToolReply({ kind: "nothing-serving" });
      const { path, size } = asked.data;
      const taken = await screenshot({
        app: opened.app,
        path,
        viewport: PREVIEW_SIZES[size],
        cookies: opened.port.cookies(),
      });
      if (!taken.ok) return previewToolReply({ kind: "failed", reason: taken.error });
      return previewToolReply({ kind: "taken", path, size, png: taken.value });
    },
  };
};

export type Previews = ReturnType<typeof createPreviews>;

/** What the screenshot tool takes: a page's path from the app's root, and a size by name. */
const ScreenshotInput = z.object({
  path: z.string().startsWith("/").max(2000),
  size: PreviewSize,
});
