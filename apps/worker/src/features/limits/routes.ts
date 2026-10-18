import { UsageNotNow } from "@courtyard/contract";
import { Hono } from "hono";
import { apiError, readBody } from "../../lib/http.ts";
import type { Usage } from "./usage.ts";

/** Usage at a glance (#66): each provider's plan meters and the warnings, and Not now. */
export const usageRoutes = (usage: Usage) => {
  const routes = new Hono();

  /**
   * The usage as last known; with `?read=1` (the Model sheet, open), read afresh first, at most
   * once a minute per provider.
   */
  routes.get("/usage", async (c) => {
    if (c.req.query("read") === "1") await usage.read();
    return c.json(await usage.list());
  });
  /** Not now: a provider's warning put off until its window resets. */
  routes.post("/usage/not-now", async (c) => {
    const body = await readBody(c, UsageNotNow);
    if (!body.ok) return apiError(c, { status: 400, error: body.error });
    const done = await usage.notNow(body.value.provider);
    if (done.ok) return c.json(done.value);
    return done.error.kind === "unknown-provider"
      ? apiError(c, { status: 404, error: "Courtyard has no provider by that name" })
      : apiError(c, { status: 500, error: "Not now couldn't be kept in the data folder" });
  });

  return routes;
};
