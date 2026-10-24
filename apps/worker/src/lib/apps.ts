import { existsSync } from "node:fs";
import { join } from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";

/**
 * Serves the apps' built files on the worker's origin, beside its API: Fabrication's under
 * `/fabrication` (#698), so it shares the owner's login, and the web app's everywhere else. Any
 * other path under each is one of its own routes, so a reload lands on that app. Without a build
 * (while developing with `pnpm dev`), Vite serves the pages instead.
 */
export const serveApps = (app: Hono, dirs: { webDir: string; fabricationDir: string }) => {
  const { webDir, fabricationDir } = dirs;
  if (existsSync(fabricationDir)) {
    const fabrication = new Hono();
    fabrication.use(
      "*",
      serveStatic({
        root: fabricationDir,
        rewriteRequestPath: (path) => path.replace(/^\/fabrication/, ""),
      }),
    );
    fabrication.get("*", serveStatic({ path: join(fabricationDir, "index.html") }));
    app.route("/fabrication", fabrication);
  }
  if (existsSync(webDir)) {
    app.use("*", serveStatic({ root: webDir }));
    app.get("*", serveStatic({ path: join(webDir, "index.html") }));
  } else {
    app.get("*", (c) =>
      c.text("The web app isn't built. Run `pnpm build`, or use `pnpm dev` while developing.", 404),
    );
  }
};
