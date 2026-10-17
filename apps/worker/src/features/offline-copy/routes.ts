import type { OfflineCopy } from "@courtyard/contract";
import { Hono } from "hono";
import { apiError, contextError } from "../../lib/http.ts";
import type { OfflineCopyMaker } from "./index.ts";

/** Read offline (#106): the copy a device keeps, asked for whenever it's opened and every 15 minutes. */
export const offlineCopyRoutes = (offlineCopy: OfflineCopyMaker) => {
  const routes = new Hono();

  routes.get("/offline-copy", async (c) => {
    const copy = await offlineCopy.copy();
    if (copy.ok) return c.json(copy.value satisfies OfflineCopy);
    return copy.error.kind === "workspace"
      ? contextError(c, copy.error.error)
      : apiError(c, { status: 500, error: copy.error.message });
  });

  return routes;
};
