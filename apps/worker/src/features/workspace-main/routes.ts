import type { WorkspaceMain } from "@courtyard/contract";
import { Hono } from "hono";
import { apiError, contextError } from "../../lib/http.ts";
import type { createWorkspaceMain } from "./index.ts";

/** A code workspace's main (#301's Main row), mounted under `/api`. */
export const workspaceMainRoutes = (
  workspaceMain: Pick<ReturnType<typeof createWorkspaceMain>, "of">,
) => {
  const routes = new Hono();

  routes.get("/workspaces/:id/main", async (c) => {
    const main = await workspaceMain.of(c.req.param("id"));
    if (main.ok) return c.json(main.value satisfies WorkspaceMain);
    switch (main.error.kind) {
      case "workspace":
        return contextError(c, main.error.error);
      case "not-code":
        return apiError(c, { status: 409, error: "Only a code workspace has a main branch." });
      case "unknown":
        return apiError(c, { status: 404, error: "This workspace's main can't be read now." });
    }
  });

  return routes;
};
