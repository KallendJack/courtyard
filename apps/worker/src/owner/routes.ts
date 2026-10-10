import { type AuthState, MIN_PASSWORD_LENGTH, PasswordForm } from "@courtyard/contract";
import { type Context, Hono, type MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { apiError, readBody } from "../http.ts";
import { deviceLoginOf, LoginSecret, type Owner, type StorageError } from "./index.ts";

/** The answer to a setup or login request that didn't send a password form. */
const PASSWORD_REFUSED = "Send a password of up to 1,024 characters";

const LOGIN_COOKIE = "courtyard_login";
/** Browsers cap a cookie's life at 400 days; it's renewed every time the device checks in. */
const LOGIN_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;
/** API paths that work without a login. */
const PUBLIC_PATHS = new Set(["/api/health", "/api/auth", "/api/setup", "/api/login"]);

const storageError = (c: Context, error: StorageError) =>
  apiError(c, { status: 500, error: error.message });

/** The device's login secret from its cookie, if it sent a well-formed one. */
const secretFrom = (c: Context) => {
  const parsed = LoginSecret.safeParse(getCookie(c, LOGIN_COOKIE));
  return parsed.success ? parsed.data : undefined;
};

/** The device login a request came from, once `requireLogin` has let it in. */
export const deviceLoginFrom = (c: Context) => {
  const secret = secretFrom(c);
  return secret === undefined ? undefined : deviceLoginOf(secret);
};

/**
 * Whether the browser reached this worker over HTTPS. Behind an HTTPS reverse proxy the worker
 * itself is reached over plain HTTP, and the proxy says what the browser used in
 * X-Forwarded-Proto. Another site can't set that header on a browser request without the worker
 * agreeing first, which it never does.
 */
const browserUsedHttps = (c: Context) =>
  new URL(c.req.url).protocol === "https:" || c.req.header("x-forwarded-proto") === "https";

/** The address the browser used to reach this worker. */
const ownOrigin = (c: Context) => {
  const url = new URL(c.req.url);
  if (browserUsedHttps(c)) url.protocol = "https:";
  return url.origin;
};

const setLoginCookie = (c: Context, secret: LoginSecret) => {
  setCookie(c, LOGIN_COOKIE, secret, {
    httpOnly: true,
    sameSite: "Strict",
    secure: browserUsedHttps(c),
    path: "/",
    maxAge: LOGIN_MAX_AGE_SECONDS,
  });
};

/**
 * Every change must be JSON from this same site. A page on another site can only send JSON after
 * the browser asks this worker first, and the worker never says yes; a browser also names the
 * site a request came from, so a mismatch is refused. This is what stops another website setting
 * up a fresh install, which needs no cookie.
 */
export const sameSiteJsonOnly =
  (options: {
    /**
     * The requests that may send a multipart form instead: a message with files attached (#78),
     * and a Thing's photo (ADR 0020).
     * Another site's page can send a form without asking, but the login cookie is SameSite=Strict,
     * so it arrives logged out, and only routes behind the login take files.
     */
    takesFiles: (c: Context) => boolean;
  }): MiddlewareHandler =>
  async (c, next) => {
    if (c.req.method === "GET" || c.req.method === "HEAD") return next();
    const origin = c.req.header("origin");
    if (origin !== undefined && origin !== ownOrigin(c)) {
      return apiError(c, { status: 403, error: "Requests must come from Courtyard itself" });
    }
    const type = c.req.header("content-type");
    const files = type?.startsWith("multipart/form-data") && options.takesFiles(c);
    if (!files && !type?.startsWith("application/json")) {
      return apiError(c, { status: 415, error: "Send JSON" });
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
    return state.value === "logged-in"
      ? next()
      : apiError(c, { status: 401, error: "Log in first" });
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
    const form = await readBody(c, PasswordForm);
    if (!form.ok) return apiError(c, { status: 400, error: PASSWORD_REFUSED });
    const secret = await owner.setUp(form.value.password);
    if (!secret.ok) {
      switch (secret.error.kind) {
        case "too-short":
          return apiError(c, {
            status: 400,
            error: `Use at least ${MIN_PASSWORD_LENGTH} characters`,
          });
        case "already-set-up":
          return apiError(c, { status: 409, error: "Courtyard is already set up" });
        case "storage":
          return storageError(c, secret.error);
      }
    }
    setLoginCookie(c, secret.value);
    return c.body(null, 201);
  });

  routes.post("/login", async (c) => {
    const form = await readBody(c, PasswordForm);
    if (!form.ok) return apiError(c, { status: 400, error: PASSWORD_REFUSED });
    const secret = await owner.logIn(form.value.password);
    if (!secret.ok) {
      switch (secret.error.kind) {
        case "not-set-up":
          return apiError(c, { status: 409, error: "Courtyard isn't set up yet" });
        case "wrong-password":
          return apiError(c, { status: 401, error: "Wrong password" });
        case "locked":
          c.header("Retry-After", String(secret.error.retryAfterSeconds));
          return apiError(c, {
            status: 429,
            error: "Too many wrong passwords. Wait a moment and try again.",
          });
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
    if (!secret) return apiError(c, { status: 401, error: "Log in first" });
    const done = await owner.logOutOthers(secret);
    if (!done.ok) return storageError(c, done.error);
    return c.body(null, 204);
  });

  return routes;
};
