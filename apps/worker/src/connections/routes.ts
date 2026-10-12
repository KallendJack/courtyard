import {
  PaperConnecting,
  type PaperFileList,
  type WorkspaceConnections,
} from "@courtyard/contract";
import { type Context, Hono } from "hono";
import { apiError, contextError, readBody } from "../http.ts";
import type { Connections, ConnectionsProblem } from "./index.ts";

/** Why a workspace's connections couldn't be shown or changed, as the API answers it. */
const connectionsProblem = (c: Context, problem: ConnectionsProblem) => {
  switch (problem.kind) {
    case "workspace":
      return contextError(c, problem.error);
    case "not-code":
      return apiError(c, { status: 409, error: "Only a code workspace has connections." });
    case "no-paper-command":
      return apiError(c, {
        status: 409,
        error:
          "Courtyard doesn't know where Paper is on the worker machine. Set COURTYARD_PAPER_COMMAND in the worker's settings.",
      });
    case "paper":
      return apiError(c, { status: 503, error: problem.message });
  }
};

/** A code workspace's connections (#308), mounted under `/api`. */
export const connectionRoutes = (connections: Connections) => {
  const routes = new Hono();

  routes.get("/workspaces/:id/connections", async (c) => {
    const found = await connections.get(c.req.param("id"));
    if (!found.ok) return connectionsProblem(c, found.error);
    return c.json(found.value satisfies WorkspaceConnections);
  });

  routes.get("/workspaces/:id/connections/paper/files", async (c) => {
    const files = await connections.paperFiles(c.req.param("id"));
    if (!files.ok) return connectionsProblem(c, files.error);
    return c.json({ files: [...files.value] } satisfies PaperFileList);
  });

  routes.post("/workspaces/:id/connections/paper", async (c) => {
    const body = await readBody(c, PaperConnecting);
    if (!body.ok) return apiError(c, { status: 400, error: body.error });
    const connected = await connections.connectPaper(c.req.param("id"), body.value);
    if (!connected.ok) return connectionsProblem(c, connected.error);
    return c.json(connected.value satisfies WorkspaceConnections);
  });

  return routes;
};
