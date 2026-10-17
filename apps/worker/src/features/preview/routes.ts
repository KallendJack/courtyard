import { type Preview, StartPreview } from "@courtyard/contract";
import { type Context, Hono } from "hono";
import { apiError, contextError, readBody } from "../../lib/http.ts";
import { sessionError } from "../sessions/routes.ts";
import type { PreviewError, Previews } from "./index.ts";

const previewError = (c: Context, error: PreviewError) => {
  switch (error.kind) {
    case "session":
      return error.error.kind === "not-code-session"
        ? apiError(c, { status: 409, error: "Only a code session previews its app." })
        : sessionError(c, error.error);
    case "workspace":
      return contextError(c, error.error);
    case "previewing":
      return apiError(c, { status: 409, error: "This session's preview is running already." });
  }
};

/** A code session's preview (#183): where it stands, and the owner's Start preview. */
export const previewRoutes = (previews: Previews) => {
  const routes = new Hono();

  routes.get("/sessions/:id/preview", async (c) => {
    const preview = await previews.of(c.req.param("id"));
    if (!preview.ok) return previewError(c, preview.error);
    return c.json(preview.value satisfies Preview);
  });

  routes.post("/sessions/:id/preview", async (c) => {
    const body = await readBody(c, StartPreview);
    if (!body.ok) return apiError(c, { status: 400, error: body.error });
    const started = await previews.start(c.req.param("id"), body.value.command);
    if (!started.ok) return previewError(c, started.error);
    const preview = await previews.of(c.req.param("id"));
    if (!preview.ok) return previewError(c, preview.error);
    return c.json(preview.value satisfies Preview, 201);
  });

  return routes;
};
