import { existsSync } from "node:fs";
import { join } from "node:path";
import { type Health, ok, type Result } from "@courtyard/contract";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { readSettings } from "./settings.ts";

export type Worker = {
  readonly app: Hono;
  readonly port: number;
};

/**
 * Builds the worker from its settings, or returns a message naming what's wrong with them.
 * The API lives under `/api`; everything else is the web app, on the same origin (ADR 0001).
 */
export const createWorker = (options: {
  env: Record<string, string | undefined>;
}): Result<Worker, string> => {
  const settings = readSettings(options.env);
  if (!settings.ok) return settings;
  const { port, webDir } = settings.value;

  const api = new Hono();
  api.get("/health", (c) => c.json({ status: "ok" } satisfies Health));
  api.all("*", (c) => c.json({ error: "Not found" }, 404));

  const app = new Hono();
  app.route("/api", api);

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
