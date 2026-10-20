import type { StatusLine } from "@courtyard/contract";
import { type Context, Hono } from "hono";
import { apiError, contextError } from "../../lib/http.ts";
import type { StatusLineRefusal, StatusLines } from "./index.ts";

/** The answer refusing a status line, in the owner's words. */
const refused = (c: Context, refusal: StatusLineRefusal) => {
  switch (refusal.kind) {
    case "workspace":
      return contextError(c, refusal.error);
    case "planning":
      return apiError(c, { status: 404, error: "Only a code workspace has a status line." });
  }
};

/** A code workspace's status line (#256), under `/api`. */
export const statusLineRoutes = (lines: StatusLines) => {
  const routes = new Hono();

  routes.get("/workspaces/:id/status-line", async (c) => {
    const line = await lines.of(c.req.param("id"));
    return line.ok ? c.json(line.value satisfies StatusLine) : refused(c, line.error);
  });

  return routes;
};
