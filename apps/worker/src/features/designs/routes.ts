import type { Designs } from "@courtyard/contract";
import { type Context, Hono } from "hono";
import { apiError, contextError } from "../../lib/http.ts";
import { createDesigns, type DesignsProblem } from "./index.ts";

/** Why a workspace's designs couldn't be shown, as the API answers it. */
const designsProblem = (c: Context, problem: DesignsProblem) => {
  switch (problem.kind) {
    case "workspace":
      return contextError(c, problem.error);
    case "no-paper":
      return apiError(c, {
        status: 409,
        error: "This workspace has no Paper file. Connect one from its page.",
      });
    case "no-picture":
      return apiError(c, { status: 404, error: "No such picture" });
  }
};

/** A code workspace's Designs tab (#522), mounted under `/api`. */
export const designRoutes = (options: Parameters<typeof createDesigns>[0]) => {
  const designs = createDesigns(options);
  const routes = new Hono();

  routes.get("/workspaces/:id/designs", async (c) => {
    const found = await designs.get(c.req.param("id"));
    if (!found.ok) return designsProblem(c, found.error);
    return c.json(found.value satisfies Designs);
  });

  // A board's picture, for its row and its full-size view.
  routes.get("/workspaces/:id/designs/pictures/:picture", async (c) => {
    const found = await designs.picture(c.req.param("id"), c.req.param("picture"));
    if (!found.ok) return designsProblem(c, found.error);
    return c.body(new Uint8Array(found.value.bytes), 200, {
      "content-type": found.value.mediaType,
      "x-content-type-options": "nosniff",
      // Only ever a picture: nothing in it runs, even opened on its own.
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
      // A picture's name changes whenever it does.
      "cache-control": "private, max-age=31536000, immutable",
    });
  });

  return routes;
};
