import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  type ApiError,
  type AuthState,
  type Health,
  MIN_PASSWORD_LENGTH,
  PasswordForm,
  type WorkspaceDetail,
  type WorkspaceList,
} from "@courtyard/contract";
import { serveStatic } from "@hono/node-server/serve-static";
import { type Context, Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { createOwner } from "./owner/index.ts";
import { ok, type Result } from "./result.ts";
import { type Environment, readSettings } from "./settings.ts";
import { getWorkspace, listWorkspaces, type WorkspaceError } from "./workspaces/index.ts";

export type { Environment };

export type Worker = {
  readonly app: Hono;
  readonly port: number;
};

const LOGIN_COOKIE = "courtyard_login";
/** Browsers cap a cookie's life at 400 days; a device stays logged in until it logs out. */
const LOGIN_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;
/** API paths that work without a login. */
const PUBLIC_PATHS = new Set(["/api/health", "/api/auth", "/api/setup", "/api/login"]);

const apiError = (c: Context, error: string, status: 400 | 401 | 404 | 409 | 429 | 500) =>
  c.json({ error } satisfies ApiError, status);

/** The form a setup or login request sent, or `undefined` when it isn't one. */
const readPasswordForm = async (c: Context) => {
  const body: unknown = await c.req.json().catch(() => undefined);
  const form = PasswordForm.safeParse(body);
  return form.success ? form.data : undefined;
};

const startLogin = (c: Context, token: string) => {
  const https =
    new URL(c.req.url).protocol === "https:" || c.req.header("x-forwarded-proto") === "https";
  setCookie(c, LOGIN_COOKIE, token, {
    httpOnly: true,
    sameSite: "Strict",
    secure: https,
    path: "/",
    maxAge: LOGIN_MAX_AGE_SECONDS,
  });
};

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

  // Only the owner gets in (ADR 0002): everything but the public paths needs a device login.
  api.use("*", async (c, next) => {
    if (PUBLIC_PATHS.has(c.req.path)) return next();
    if ((await owner.state(getCookie(c, LOGIN_COOKIE))) !== "logged-in") {
      return apiError(c, "Log in first", 401);
    }
    return next();
  });

  api.get("/health", (c) => c.json({ status: "ok" } satisfies Health));

  api.get("/auth", async (c) =>
    c.json({ state: await owner.state(getCookie(c, LOGIN_COOKIE)) } satisfies AuthState),
  );

  api.post("/setup", async (c) => {
    const form = await readPasswordForm(c);
    if (!form) return apiError(c, "Send a password", 400);
    const token = await owner.setUp(form.password);
    if (!token.ok) {
      return token.error.kind === "too-short"
        ? apiError(c, `Use at least ${MIN_PASSWORD_LENGTH} characters`, 400)
        : apiError(c, "Courtyard is already set up", 409);
    }
    startLogin(c, token.value);
    return c.body(null, 201);
  });

  api.post("/login", async (c) => {
    const form = await readPasswordForm(c);
    if (!form) return apiError(c, "Send a password", 400);
    const token = await owner.logIn(form.password);
    if (!token.ok) {
      switch (token.error.kind) {
        case "not-set-up":
          return apiError(c, "Courtyard isn't set up yet", 409);
        case "wrong-password":
          return apiError(c, "Wrong password", 401);
        case "locked":
          c.header("Retry-After", String(token.error.retryAfterSeconds));
          return apiError(c, "Too many wrong passwords. Wait a moment and try again.", 429);
      }
    }
    startLogin(c, token.value);
    return c.body(null, 200);
  });

  api.post("/logout", async (c) => {
    const token = getCookie(c, LOGIN_COOKIE);
    if (token) await owner.logOut(token);
    deleteCookie(c, LOGIN_COOKIE, { path: "/" });
    return c.body(null, 204);
  });

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
