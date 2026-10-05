import type { Hono } from "hono";

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
  const cookie = /(courtyard_login=[^;]+)/.exec(setup.headers.get("set-cookie") ?? "")?.[1];
  if (!cookie) throw new Error(`setting up the owner failed with ${setup.status}`);
  return (path: string) => app.request(path, { headers: { cookie } });
};
