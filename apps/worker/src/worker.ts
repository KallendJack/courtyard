import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  type Health,
  type LiveStatus,
  NewWorkspace,
  type OwnerContextDetail,
  WorkspaceChange,
  type WorkspaceDetail,
  type WorkspaceList,
  type WorkspaceSummary,
} from "@courtyard/contract";
import { serveStatic } from "@hono/node-server/serve-static";
import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { apiError, readBody } from "./http.ts";
import { createLive, runUpdateTask, type UpdateCommand } from "./live/index.ts";
import { createOwner } from "./owner/index.ts";
import { loginRoutes, requireLogin, sameSiteJsonOnly } from "./owner/routes.ts";
import { readOwnerContext, startOwnerContext } from "./owner-context/index.ts";
import { sharedOwnerContext } from "./prompts/index.ts";
import { createClaudeProvider, createFakeProvider, type Provider } from "./providers/index.ts";
import { ok, type Result } from "./result.ts";
import { createSessions } from "./sessions/index.ts";
import { sessionRoutes } from "./sessions/routes.ts";
import { type Environment, readSettings } from "./settings.ts";
import {
  createWorkspace,
  getWorkspace,
  listWorkspaces,
  setWorkspaceColour,
  type WorkspaceError,
} from "./workspaces/index.ts";

export type { Environment, UpdateCommand };

export type Worker = {
  readonly app: Hono;
  readonly port: number;
};

/** The largest request body the API reads; nothing it accepts comes close. */
const MAX_BODY_BYTES = 16 * 1024;

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
}): Result<Worker, string> => {
  const settings = readSettings(options.env);
  if (!settings.ok) return settings;
  const { port, contextDir, dataDir, webDir, claudeProvider, fakeProvider, liveCopy, updateTask } =
    settings.value;
  const now = options.now ?? Date.now;
  const owner = createOwner({ dataDir, now });
  // Claude first, so it's the default model wherever it's available.
  const providers = options.providers ?? [
    ...(claudeProvider ? [createClaudeProvider()] : []),
    ...(fakeProvider ? [createFakeProvider()] : []),
  ];
  const sessions = createSessions({ dataDir, providers, contextDir, now });
  const live = createLive({
    liveCopy,
    updateTask,
    dataDir,
    now,
    startUpdate: options.startUpdate ?? runUpdateTask,
  });

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

  /** An error reading or changing the context folder, as an answer. */
  const contextError = (c: Context, error: WorkspaceError) => {
    switch (error.kind) {
      case "not-found":
        return apiError(c, { status: 404, error: "No such workspace" });
      case "invalid":
        return apiError(c, { status: 400, error: error.message });
      case "conflict":
        return apiError(c, { status: 409, error: error.message });
      case "storage":
        return apiError(c, { status: 500, error: error.message });
    }
  };

  api.get("/workspaces", async (c) => {
    const workspaces = await listWorkspaces(contextDir);
    if (!workspaces.ok) return contextError(c, workspaces.error);
    return c.json({ workspaces: workspaces.value } satisfies WorkspaceList);
  });
  api.post("/workspaces", async (c) => {
    const body = await readBody(c, NewWorkspace);
    if (!body.ok) return apiError(c, { status: 400, error: body.error });
    const workspace = await createWorkspace(contextDir, body.value.name);
    if (!workspace.ok) return contextError(c, workspace.error);
    return c.json(workspace.value satisfies WorkspaceSummary, 201);
  });
  api.patch("/workspaces/:id", async (c) => {
    const body = await readBody(c, WorkspaceChange);
    if (!body.ok) return apiError(c, { status: 400, error: body.error });
    const workspace = await setWorkspaceColour(contextDir, {
      id: c.req.param("id"),
      colour: body.value.colour,
    });
    if (!workspace.ok) return contextError(c, workspace.error);
    return c.json(workspace.value satisfies WorkspaceSummary);
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
    const started = await startOwnerContext(contextDir);
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
