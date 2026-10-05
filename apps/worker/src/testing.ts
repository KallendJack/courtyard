import type { Hono } from "hono";

/** For tests: the `name=value` part of the login cookie a response set. */
export const loginCookie = (response: Response) => {
  const header = response.headers.get("set-cookie") ?? "";
  const match = /(courtyard_login=[^;]+)/.exec(header);
  if (!match?.[1]) throw new Error(`no login cookie (status ${response.status}): ${header}`);
  return match[1];
};

/**
 * For tests: sets up the owner on a fresh worker and returns a way to make requests as the owner.
 * Goes through the API like a browser would, so tests still only touch the worker's front door.
 */
export const asOwner = async (app: Hono) => {
  const setup = await app.request("/api/setup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: "test password" }),
  });
  const cookie = loginCookie(setup);
  return (path: string, init: RequestInit = {}) =>
    app.request(path, { ...init, headers: { ...init.headers, cookie } });
};
