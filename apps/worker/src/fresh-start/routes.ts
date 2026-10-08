import { FreshStartRequest, type FreshStartSummary } from "@courtyard/contract";
import { Hono } from "hono";
import { apiError, readBody } from "../http.ts";
import type { FreshStart } from "./index.ts";

/** Fresh start, under `/api`: what it would clear, and starting fresh. */
export const freshStartRoutes = (freshStart: FreshStart) => {
  const routes = new Hono();

  routes.get("/fresh-start", async (c) => {
    const summary = await freshStart.summary();
    if (!summary.ok) return apiError(c, { status: 500, error: summary.error });
    return c.json(summary.value satisfies FreshStartSummary);
  });

  routes.post("/fresh-start", async (c) => {
    const body = await readBody(c, FreshStartRequest);
    if (!body.ok) return apiError(c, { status: 400, error: body.error });
    const started = await freshStart.start();
    if (started.ok) return c.body(null, 204);
    const refusal = started.error;
    switch (refusal.kind) {
      case "running":
        return apiError(c, {
          status: 409,
          error: `“${refusal.session.title}” in ${refusal.session.workspaceName} is answering. Stop it or let it finish, then start fresh.`,
        });
      case "underway":
        return apiError(c, { status: 409, error: "A fresh start is already under way." });
      case "not-kept":
        return apiError(c, {
          status: 500,
          error:
            "The context folder can't be kept in git right now, so a fresh start would lose it. Nothing was cleared.",
        });
      case "storage":
        return apiError(c, { status: 500, error: refusal.message });
    }
  });

  return routes;
};
