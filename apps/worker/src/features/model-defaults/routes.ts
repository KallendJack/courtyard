import { ModelDefault } from "@courtyard/contract";
import { Hono } from "hono";
import { apiError, readBody } from "../../lib/http.ts";
import type { ModelDefaults } from "./index.ts";

/** Make this the default (#247), under `/api`: a provider's default model and effort. */
export const modelDefaultRoutes = (defaults: ModelDefaults) => {
  const routes = new Hono();

  routes.put("/providers/:id/default", async (c) => {
    const body = await readBody(c, ModelDefault);
    if (!body.ok) return apiError(c, { status: 400, error: body.error });
    const saved = await defaults.save(c.req.param("id"), body.value);
    if (saved.ok) return c.json(saved.value satisfies ModelDefault);
    switch (saved.error.kind) {
      case "no-provider":
        return apiError(c, { status: 404, error: "No such provider" });
      case "not-offered":
        return apiError(c, {
          status: 409,
          error: `${saved.error.provider} doesn't offer that model now.`,
        });
      case "no-such-effort":
        return apiError(c, { status: 400, error: "That model doesn't take that effort." });
      case "storage":
        return apiError(c, { status: 500, error: "The default couldn't be saved." });
    }
  });

  return routes;
};
