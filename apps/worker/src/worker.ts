import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ApiError, Health, WorkspaceDetail, WorkspaceList } from "@courtyard/contract";
import { serveStatic } from "@hono/node-server/serve-static";
import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { createOwner } from "./owner/index.ts";
import { loginRoutes, requireLogin, sameSiteJsonOnly } from "./owner/routes.ts";
import { ok, type Result } from "./result.ts";
import { type Environment, readSettings } from "./settings.ts";
import { getWorkspace, listWorkspaces, type WorkspaceError } from "./workspaces/index.ts";

export type { Environment };

export type Worker = {
  readonly app: Hono;
  readonly port: number;
};

/** The largest request body the API reads; nothing it accepts comes close. */
const MAX_BODY_BYTES = 16 * 1024;

const apiError = (c: Context, error: string, status: 404 | 413 | 500) =>
  c.json({ error } satisfies ApiError, status);

/**
 * Builds the worker from its settings, or returns a message naming what's wrong with them.
 * The API lives under `/api`; everything else is the web app, on the same origin (ADR 0001).
 * `now` is the clock, passed in so tests can move time.
 */
export const createWorker = (options: {
  env: Environment;
  now?: () => number;
}): Result<Worker, string> => {
  const settings = readSettings(options.env);
  if (!settings.ok) return settings;
  const { port, contextDir, dataDir, webDir } = settings.value;
  const owner = createOwner({ dataDir, now: options.now ?? Date.now });

  const api = new Hono();
  api.use(
    "*",
    bodyLimit({ maxSize: MAX_BODY_BYTES, onError: (c) => apiError(c, "Request too large", 413) }),
  );
  api.use("*", sameSiteJsonOnly);
  api.use("*", requireLogin(owner));

  api.get("/health", (c) => c.json({ status: "ok" } satisfies Health));
  api.route("/", loginRoutes(owner));

  const workspaceError = (c: Context, error: WorkspaceError) =>
    error.kind === "not-found"
      ? apiError(c, "No such workspace", 404)
      : apiError(c, error.message, 500);

  api.get("/workspaces", async (c) => {
    const workspaces = await listWorkspaces(contextDir);
    if (!workspaces.ok) return workspaceError(c, workspaces.error);
    return c.json({ workspaces: workspaces.value } satisfies WorkspaceList);
  });
  api.get("/workspaces/:id", async (c) => {
    const workspace = await getWorkspace(contextDir, c.req.param("id"));
    if (!workspace.ok) return workspaceError(c, workspace.error);
    return c.json({
      workspace: workspace.value.summary,
      contextFile: workspace.value.contextFile,
    } satisfies WorkspaceDetail);
  });
  api.all("*", (c) => apiError(c, "Not found", 404));

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
