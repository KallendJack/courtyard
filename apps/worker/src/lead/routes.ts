import { LeadRun, type LeadStatus } from "@courtyard/contract";
import { type Context, Hono } from "hono";
import { apiError, contextError, readBody } from "../http.ts";
import { sessionError } from "../sessions/routes.ts";
import type { Lead, LeadProblem } from "./index.ts";

/** Why a Lead couldn't be read or run, as the API answers it. */
const leadProblem = (c: Context, problem: LeadProblem) => {
  switch (problem.kind) {
    case "workspace":
      return contextError(c, problem.error);
    case "not-code":
      return apiError(c, { status: 409, error: "Only a code workspace has a Lead." });
    case "session":
      return problem.error.kind === "not-found"
        ? apiError(c, { status: 404, error: "This workspace's Lead hasn't started yet." })
        : sessionError(c, problem.error);
    case "storage":
      return apiError(c, {
        status: 500,
        error: "The Lead's record in Courtyard's data folder can't be read or written.",
      });
    case "nothing-to-merge":
      return apiError(c, { status: 409, error: "Nothing is ready to merge yet." });
  }
};

/** A code workspace's Lead (#347): where it stands, Run the build order, Merge in order (#423) and Pause. */
export const leadRoutes = (lead: Lead) => {
  const routes = new Hono();

  routes.get("/workspaces/:id/lead", async (c) => {
    const status = await lead.status(c.req.param("id"));
    if (!status.ok) return leadProblem(c, status.error);
    return c.json(status.value satisfies LeadStatus);
  });

  routes.post("/workspaces/:id/lead/run", async (c) => {
    const body = await readBody(c, LeadRun);
    if (!body.ok) return apiError(c, { status: 400, error: body.error });
    const run = await lead.run(c.req.param("id"), body.value);
    if (!run.ok) return leadProblem(c, run.error);
    return c.json(run.value satisfies LeadStatus);
  });

  routes.post("/workspaces/:id/lead/merge-in-order", async (c) => {
    const merging = await lead.mergeInOrder(c.req.param("id"));
    if (!merging.ok) return leadProblem(c, merging.error);
    return c.json(merging.value satisfies LeadStatus);
  });

  routes.post("/workspaces/:id/lead/pause", async (c) => {
    const paused = await lead.pause(c.req.param("id"));
    if (!paused.ok) return leadProblem(c, paused.error);
    return c.json(paused.value satisfies LeadStatus);
  });

  return routes;
};
