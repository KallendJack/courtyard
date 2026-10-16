import type { RunningTasks, TaskOutput } from "@courtyard/contract";
import { Hono } from "hono";
import type { Sessions } from "../sessions/index.ts";
import { sessionError } from "../sessions/routes.ts";

/** A code session's tasks (#182): those running, each one's output, and the owner's Stop. */
export const taskRoutes = (sessions: Sessions) => {
  const routes = new Hono();

  // Those still running, for the row above the Reply box.
  routes.get("/sessions/:id/tasks", async (c) => {
    const listed = await sessions.runningTasks(c.req.param("id"));
    if (!listed.ok) return sessionError(c, listed.error);
    return c.json(listed.value satisfies RunningTasks);
  });

  // A task's output, its end, from the data folder.
  routes.get("/sessions/:id/tasks/:task/output", async (c) => {
    const output = await sessions.taskOutput(c.req.param("id"), c.req.param("task"));
    if (!output.ok) return sessionError(c, output.error);
    return c.json(output.value satisfies TaskOutput);
  });

  routes.post("/sessions/:id/tasks/:task/stop", async (c) => {
    const stopped = await sessions.stopTask(c.req.param("id"), c.req.param("task"));
    if (!stopped.ok) return sessionError(c, stopped.error);
    return c.body(null, 204);
  });

  return routes;
};
