import {
  type ApiError,
  type AuthState,
  MIN_PASSWORD_LENGTH,
  PasswordForm,
} from "@courtyard/contract";
import { type Context, Hono, type MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { LoginSecret, type Owner, type StorageError } from "./index.ts";

const LOGIN_COOKIE = "courtyard_login";
/** Browsers cap a cookie's life at 400 days; it's renewed every time the device checks in. */
const LOGIN_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;
/** API paths that work without a login. */
const PUBLIC_PATHS = new Set(["/api/health", "/api/auth", "/api/setup", "/api/login"]);

type ErrorStatus = 400 | 401 | 403 | 409 | 415 | 429 | 500;
const apiError = (c: Context, error: string, status: ErrorStatus) =>
  c.json({ error } satisfies ApiError, status);
const storageError = (c: Context, error: StorageError) => apiError(c, error.message, 500);

/** The device's login secret from its cookie, if it sent a well-formed one. */
const secretFrom = (c: Context) => {
  const parsed = LoginSecret.safeParse(getCookie(c, LOGIN_COOKIE));
  return parsed.success ? parsed.data : undefined;
};

const setLoginCookie = (c: Context, secret: LoginSecret) => {
  const https =
    new URL(c.req.url).protocol === "https:" || c.req.header("x-forwarded-proto") === "https";
  setCookie(c, LOGIN_COOKIE, secret, {
    httpOnly: true,
    sameSite: "Strict",
    secure: https,
    path: "/",
    maxAge: LOGIN_MAX_AGE_SECONDS,
  });
};

/** The form a setup or login request sent, or `undefined` when it isn't one. */
const readPasswordForm = async (c: Context) => {
  const body: unknown = await c.req.json().catch(() => undefined);
  const form = PasswordForm.safeParse(body);
  return form.success ? form.data : undefined;
};

/**
 * Every change must be JSON from this same site. A page on another site can only send JSON after
 * the browser asks this worker first, and the worker never says yes; a browser also names the
 * site a request came from, so a mismatch is refused. This is what stops another website setting
 * up a fresh install, which needs no cookie.
 */
export const sameSiteJsonOnly: MiddlewareHandler = async (c, next) => {
  if (c.req.method === "GET" || c.req.method === "HEAD") return next();
  const origin = c.req.header("origin");
  if (origin !== undefined && origin !== new URL(c.req.url).origin) {
    return apiError(c, "Requests must come from Courtyard itself", 403);
  }
  if (!c.req.header("content-type")?.startsWith("application/json")) {
    return apiError(c, "Send JSON", 415);
  }
  return next();
};

/** Only the owner gets in (ADR 0002): everything but the public paths needs a device login. */
export const requireLogin =
  (owner: Owner): MiddlewareHandler =>
  async (c, next) => {
    if (PUBLIC_PATHS.has(c.req.path)) return next();
    const state = await owner.state(secretFrom(c));
    if (!state.ok) return storageError(c, state.error);
    return state.value === "logged-in" ? next() : apiError(c, "Log in first", 401);
  };

/** Setup, login and logout, mounted under `/api`. */
export const loginRoutes = (owner: Owner) => {
  const routes = new Hono();

  routes.get("/auth", async (c) => {
    const secret = secretFrom(c);
    const state = await owner.state(secret);
    if (!state.ok) return storageError(c, state.error);
    // A device in use keeps renewing its cookie, so it never drops out at the 400-day cap.
    if (state.value === "logged-in" && secret) setLoginCookie(c, secret);
    return c.json({ state: state.value } satisfies AuthState);
  });

  routes.post("/setup", async (c) => {
    const form = await readPasswordForm(c);
    if (!form) return apiError(c, "Send a password of up to 1,024 characters", 400);
    const secret = await owner.setUp(form.password);
    if (!secret.ok) {
      switch (secret.error.kind) {
        case "too-short":
          return apiError(c, `Use at least ${MIN_PASSWORD_LENGTH} characters`, 400);
        case "already-set-up":
          return apiError(c, "Courtyard is already set up", 409);
        case "storage":
          return storageError(c, secret.error);
      }
    }
    setLoginCookie(c, secret.value);
    return c.body(null, 201);
  });

  routes.post("/login", async (c) => {
    const form = await readPasswordForm(c);
    if (!form) return apiError(c, "Send a password of up to 1,024 characters", 400);
    const secret = await owner.logIn(form.password);
    if (!secret.ok) {
      switch (secret.error.kind) {
        case "not-set-up":
          return apiError(c, "Courtyard isn't set up yet", 409);
        case "wrong-password":
          return apiError(c, "Wrong password", 401);
        case "locked":
          c.header("Retry-After", String(secret.error.retryAfterSeconds));
          return apiError(c, "Too many wrong passwords. Wait a moment and try again.", 429);
        case "storage":
          return storageError(c, secret.error);
      }
    }
    setLoginCookie(c, secret.value);
    return c.body(null, 200);
  });

  routes.post("/logout", async (c) => {
    const secret = secretFrom(c);
    if (secret) {
      const done = await owner.logOut(secret);
      if (!done.ok) return storageError(c, done.error);
    }
    deleteCookie(c, LOGIN_COOKIE, { path: "/" });
    return c.body(null, 204);
  });

  routes.post("/logout-others", async (c) => {
    const secret = secretFrom(c);
    if (!secret) return apiError(c, "Log in first", 401);
    const done = await owner.logOutOthers(secret);
    if (!done.ok) return storageError(c, done.error);
    return c.body(null, 204);
  });

  return routes;
};
