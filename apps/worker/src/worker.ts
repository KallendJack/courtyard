import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  type ContextBackup,
  type Health,
  type LiveStatus,
  NewWorkspace,
  type OwnerContextDetail,
  WorkspaceChange,
  type WorkspaceDetail,
  WorkspaceId,
  type WorkspaceList,
  type WorkspaceSummary,
} from "@courtyard/contract";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { changeRoutes } from "./changes/routes.ts";
import { createContextFolder, workspaceChange } from "./context-folder/index.ts";
import { createFreshStart } from "./fresh-start/index.ts";
import { freshStartRoutes } from "./fresh-start/routes.ts";
import { apiError, contextError, readBody } from "./http.ts";
import { rememberingLimits } from "./limits/index.ts";
import { createLive, runUpdateTask, type UpdateCommand } from "./live/index.ts";
import { createOwner } from "./owner/index.ts";
import { loginRoutes, requireLogin, sameSiteJsonOnly } from "./owner/routes.ts";
import { readOwnerContext, startOwnerContext } from "./owner-context/index.ts";
import { sharedOwnerContext } from "./prompts/index.ts";
import {
  createClaudeProvider,
  createCodexProvider,
  createFakeProvider,
  type Provider,
} from "./providers/index.ts";
import { ok, type Result } from "./result.ts";
import { createSessions } from "./sessions/index.ts";
import { sessionRoutes } from "./sessions/routes.ts";
import { type Environment, readSettings } from "./settings.ts";
import { createSignIns } from "./sign-ins/index.ts";
import { signInRoutes } from "./sign-ins/routes.ts";
import { createTidying } from "./tidy/index.ts";
import { tidyRoutes } from "./tidy/routes.ts";
import {
  archiveWorkspace,
  changeWorkspace,
  createWorkspace,
  getWorkspace,
  listWorkspaces,
} from "./workspaces/index.ts";

export type { Environment, UpdateCommand };

export type Worker = {
  readonly app: Hono;
  readonly port: number;
};

/** The largest request body the API reads; nothing it accepts comes close. */
const MAX_BODY_BYTES = 16 * 1024;

/** How long the fake's pretend sign-in takes to finish, when it acts signed out. */
const FAKE_SIGN_IN_MS = 5000;

/** How often the context folder's hand edits are committed and a failed backup retried. */
const KEEP_UP_EVERY_MS = 10 * 60 * 1000;

/** Runs a job now and every `everyMs`, never overlapping itself. */
export type Repeat = (everyMs: number, job: () => Promise<void>) => void;

const repeatForever: Repeat = (everyMs, job) => {
  let busy = false;
  const once = async () => {
    if (busy) return;
    busy = true;
    try {
      await job();
    } catch (error) {
      console.error(error);
    } finally {
      busy = false;
    }
  };
  void once();
  // Never keeps the process alive on its own.
  setInterval(() => void once(), everyMs).unref();
};

/**
 * Builds the worker from its settings, or returns a message naming what's wrong with them.
 * The API lives under `/api`; everything else is the web app, on the same origin (ADR 0001).
 * `now` is the clock, passed in so tests can move time.
 */
export const createWorker = (options: {
  env: Environment;
  now?: () => number;
  /** The providers to offer. Tests pass their own; otherwise the settings decide. */
  providers?: readonly Provider[];
  /** Starts an update of the live copy. Tests watch it; otherwise Task Scheduler runs it. */
  startUpdate?: (command: UpdateCommand) => void | Promise<void>;
  /** Runs a job now and every `everyMs`. Tests run it themselves when they want it. */
  repeat?: Repeat;
}): Result<Worker, string> => {
  const settings = readSettings(options.env);
  if (!settings.ok) return settings;
  const {
    port,
    contextDir,
    contextRemote,
    dataDir,
    webDir,
    claudeProvider,
    codexProvider,
    fakeProvider,
    fakeSignIn,
    secondFakeProvider,
    liveCopy,
    updateTask,
  } = settings.value;
  const now = options.now ?? Date.now;
  const owner = createOwner({ dataDir, now });
  // Claude first, so it's the default model wherever it's available.
  const providers = rememberingLimits(
    options.providers ?? [
      ...(claudeProvider ? [createClaudeProvider()] : []),
      ...(codexProvider ? [createCodexProvider({ dataDir })] : []),
      ...(fakeProvider
        ? [createFakeProvider(fakeSignIn ? { signIn: { finishAfterMs: FAKE_SIGN_IN_MS } } : {})]
        : []),
      ...(secondFakeProvider ? [createFakeProvider({ second: true })] : []),
    ],
    now,
  );
  const contextFolder = createContextFolder({ contextDir, remote: contextRemote });
  const sessions = createSessions({ dataDir, providers, contextDir, contextFolder, now });
  const live = createLive({
    liveCopy,
    updateTask,
    dataDir,
    now,
    startUpdate: options.startUpdate ?? runUpdateTask,
  });
  (options.repeat ?? repeatForever)(KEEP_UP_EVERY_MS, contextFolder.keepUp);

  const api = new Hono();
  api.use(
    "*",
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: (c) => apiError(c, { status: 413, error: "Request too large" }),
    }),
  );
  api.use("*", sameSiteJsonOnly);
  api.use("*", requireLogin(owner));

  api.get("/health", (c) => c.json({ status: "ok" } satisfies Health));
  api.route("/", loginRoutes(owner));
  api.route("/", sessionRoutes({ sessions, providers, contextDir }));
  api.route("/", changeRoutes({ contextDir, contextFolder, sessions }));
  const tidying = createTidying({ contextDir, contextFolder, providers, now });
  api.route("/", tidyRoutes({ contextDir, tidying }));
  api.route(
    "/",
    freshStartRoutes(
      createFreshStart({ contextDir, dataDir, contextFolder, sessions, tidying, now }),
    ),
  );
  api.route("/", signInRoutes(createSignIns({ providers, dataDir })));

  api.get("/backup", async (c) => c.json((await contextFolder.backup()) satisfies ContextBackup));
  api.get("/live", async (c) => c.json((await live.status()) satisfies LiveStatus));
  api.post("/live/update", async (c) => {
    const started = await live.update();
    if (started.ok) return c.body(null, 202);
    switch (started.error.kind) {
      case "off":
        return apiError(c, { status: 404, error: "Updates from the app are off on this worker." });
      case "running":
        return apiError(c, { status: 409, error: "An update is already running." });
      case "not-started":
        return apiError(c, { status: 500, error: started.error.message });
    }
  });

  api.get("/workspaces", async (c) => {
    const workspaces = await listWorkspaces(contextDir);
    if (!workspaces.ok) return contextError(c, workspaces.error);
    return c.json({ workspaces: workspaces.value } satisfies WorkspaceList);
  });
  api.post("/workspaces", async (c) => {
    const body = await readBody(c, NewWorkspace);
    if (!body.ok) return apiError(c, { status: 400, error: body.error });
    const workspace = await contextFolder.change(
      () => createWorkspace(contextDir, body.value.name),
      (made) => workspaceChange(`New workspace: ${made.name}`, made.id),
    );
    if (!workspace.ok) return contextError(c, workspace.error);
    return c.json(workspace.value satisfies WorkspaceSummary, 201);
  });
  api.patch("/workspaces/:id", async (c) => {
    const body = await readBody(c, WorkspaceChange);
    if (!body.ok) return apiError(c, { status: 400, error: body.error });
    const workspace = await contextFolder.change(
      () => changeWorkspace(contextDir, { id: c.req.param("id"), ...body.value }),
      (made) => workspaceChange(`Change the workspace ${made.name}`, made.id),
    );
    if (!workspace.ok) return contextError(c, workspace.error);
    return c.json(workspace.value satisfies WorkspaceSummary);
  });
  api.post("/workspaces/:id/archive", async (c) => {
    const id = WorkspaceId.safeParse(c.req.param("id"));
    if (!id.success) return contextError(c, { kind: "not-found" });
    // Its folder can't move while a model is working in it.
    const running = await sessions.anyRunning(id.data);
    if (!running.ok) return apiError(c, { status: 500, error: "Its sessions can't be read." });
    if (running.value) {
      return apiError(c, {
        status: 409,
        error:
          "A turn is running in one of this workspace's sessions. Stop it first, then archive the workspace.",
      });
    }
    const archived = await contextFolder.change(
      () => archiveWorkspace(contextDir, id.data),
      () => workspaceChange(`Archive the workspace ${id.data}`, id.data),
    );
    if (!archived.ok) return contextError(c, archived.error);
    return c.body(null, 204);
  });
  api.get("/workspaces/:id", async (c) => {
    const [workspace, ownerContext] = await Promise.all([
      getWorkspace(contextDir, c.req.param("id")),
      readOwnerContext(contextDir),
    ]);
    if (!workspace.ok) return contextError(c, workspace.error);
    if (!ownerContext.ok) return contextError(c, ownerContext.error);
    const { shared } = sharedOwnerContext({
      mode: workspace.value.summary.mode,
      ownerContext: ownerContext.value,
    });
    return c.json({
      workspace: workspace.value.summary,
      contextFile: workspace.value.contextFile,
      ownerContextShared: shared,
    } satisfies WorkspaceDetail);
  });
  api.get("/owner-context", async (c) => {
    const read = await readOwnerContext(contextDir);
    if (!read.ok) return contextError(c, read.error);
    return c.json({ ownerContext: read.value?.ownerContext ?? null } satisfies OwnerContextDetail);
  });
  api.post("/owner-context", async (c) => {
    const started = await contextFolder.change(
      () => startOwnerContext(contextDir),
      () => ({
        kind: "owner-context",
        title: "Start the owner context",
        places: [{ kind: "owner-context" }],
      }),
    );
    if (!started.ok) return contextError(c, started.error);
    return c.json({ ownerContext: started.value.ownerContext } satisfies OwnerContextDetail, 201);
  });
  api.all("*", (c) => apiError(c, { status: 404, error: "Not found" }));

  const app = new Hono();
  app.route("/api", api);

  // Without a build (while developing with `pnpm dev`), Vite serves the page instead.
  if (existsSync(webDir)) {
    app.use("*", serveStatic({ root: webDir }));
    // Any other path is one of the web app's own routes, so a reload lands on the app.
    app.get("*", serveStatic({ path: join(webDir, "index.html") }));
  } else {
    app.get("*", (c) =>
      c.text("The web app isn't built. Run `pnpm build`, or use `pnpm dev` while developing.", 404),
    );
  }

  return ok({ app, port });
};
