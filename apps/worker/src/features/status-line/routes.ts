import { type StatusLine, StatusLineChange } from "@courtyard/contract";
import { type Context, Hono } from "hono";
import { apiError, contextError, readBody } from "../../lib/http.ts";
import type { StatusLineRefusal, StatusLines } from "./index.ts";

/** The answer refusing a status line, in the owner's words. */
const refused = (c: Context, refusal: StatusLineRefusal) => {
  switch (refusal.kind) {
    case "workspace":
      return contextError(c, refusal.error);
    case "empty":
      return apiError(c, { status: 404, error: "There's nothing there to tick." });
    case "not-editable":
      return apiError(c, {
        status: 409,
        error: "A code workspace's line is built from its pull requests and issues.",
      });
    case "storage":
      return apiError(c, { status: 500, error: "The line can't be kept." });
  }
};

/** A workspace's status line (#256) and the owner's changes to it, under `/api`. */
export const statusLineRoutes = (lines: StatusLines) => {
  const routes = new Hono();

  routes.get("/workspaces/:id/status-line", async (c) => {
    const line = await lines.of(c.req.param("id"));
    return line.ok ? c.json(line.value satisfies StatusLine) : refused(c, line.error);
  });

  routes.post("/workspaces/:id/status-line", async (c) => {
    const body = await readBody(c, StatusLineChange);
    if (!body.ok) return apiError(c, { status: 400, error: body.error });
    const line = await lines.change(c.req.param("id"), body.value);
    return line.ok ? c.json(line.value satisfies StatusLine) : refused(c, line.error);
  });

  return routes;
};
