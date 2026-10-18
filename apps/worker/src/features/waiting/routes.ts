import type { NeedsYou } from "@courtyard/contract";
import { Hono } from "hono";
import { contextError } from "../../lib/http.ts";
import type { Sessions } from "../sessions/index.ts";
import { sessionError } from "../sessions/routes.ts";
import { listWorkspaces } from "../workspaces/index.ts";
import { needsYouOf } from "./index.ts";

/** Everything waiting on the owner, in every workspace (#492), mounted under `/api`. */
export const waitingRoutes = (options: { contextDir: string; sessions: Sessions }) => {
  const routes = new Hono();

  routes.get("/needs-you", async (c) => {
    const workspaces = await listWorkspaces(options.contextDir);
    if (!workspaces.ok) return contextError(c, workspaces.error);
    const listed = [];
    for (const workspace of workspaces.value) {
      const sessions = await options.sessions.list(workspace.id);
      if (!sessions.ok) return sessionError(c, sessions.error);
      listed.push({ workspace, sessions: sessions.value });
    }
    return c.json(needsYouOf(listed) satisfies NeedsYou);
  });

  return routes;
};
