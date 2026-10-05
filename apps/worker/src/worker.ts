import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ApiError, Health, WorkspaceDetail, WorkspaceList } from "@courtyard/contract";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { ok, type Result } from "./result.ts";
import { type Environment, readSettings } from "./settings.ts";
import { getWorkspace, listWorkspaces } from "./workspaces/index.ts";

export type { Environment };

export type Worker = {
  readonly app: Hono;
  readonly port: number;
};

/**
 * Builds the worker from its settings, or returns a message naming what's wrong with them.
 * The API lives under `/api`; everything else is the web app, on the same origin (ADR 0001).
 */
export const createWorker = (options: { env: Environment }): Result<Worker, string> => {
  const settings = readSettings(options.env);
  if (!settings.ok) return settings;
  const { port, contextDir, webDir } = settings.value;

  const api = new Hono();
  api.get("/health", (c) => c.json({ status: "ok" } satisfies Health));
  api.get("/workspaces", async (c) => {
    const workspaces = await listWorkspaces(contextDir);
    if (!workspaces.ok) return c.json({ error: workspaces.error } satisfies ApiError, 500);
    return c.json({ workspaces: workspaces.value } satisfies WorkspaceList);
  });
  api.get("/workspaces/:id", async (c) => {
    const workspace = await getWorkspace(contextDir, c.req.param("id"));
    if (!workspace) return c.json({ error: "No such workspace" } satisfies ApiError, 404);
    return c.json({
      workspace: workspace.summary,
      context: workspace.context,
    } satisfies WorkspaceDetail);
  });
  api.all("*", (c) => c.json({ error: "Not found" } satisfies ApiError, 404));

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
