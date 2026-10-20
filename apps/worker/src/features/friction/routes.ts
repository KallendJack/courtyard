import { FrictionReport, type SessionSummary } from "@courtyard/contract";
import { Hono } from "hono";
import { apiError, readMessage } from "../../lib/http.ts";
import { prepareAttachments } from "../attachments/index.ts";
import { sessionError } from "../sessions/routes.ts";
import type { Friction } from "./index.ts";

/** Filing a report, under `/api`: the one route here a multipart form, with the screen, may come to. */
export const FRICTION_ROUTE = "/friction";

/** Why a report can only carry the screen. */
const ONLY_THE_SCREEN = "A report carries one picture, the screen it was made on";

/** Something's off (#554), mounted under `/api`. */
export const frictionRoutes = (friction: Friction) => {
  const routes = new Hono();

  routes.get(FRICTION_ROUTE, async (c) => c.json(await friction.place()));

  routes.post(FRICTION_ROUTE, async (c) => {
    const sent = await readMessage(c, FrictionReport);
    if (!sent.ok) return apiError(c, { status: 400, error: sent.error });
    const { message, files } = sent.value;
    if (files.length > 1) return apiError(c, { status: 400, error: ONLY_THE_SCREEN });
    const prepared = await prepareAttachments(files);
    if (!prepared.ok) return apiError(c, { status: 400, error: prepared.error });
    const [screen] = prepared.value;
    if (screen !== undefined && screen.attachment.kind !== "photo") {
      return apiError(c, { status: 400, error: ONLY_THE_SCREEN });
    }
    const filed = await friction.file(message, screen);
    if (filed.ok) return c.json(filed.value satisfies SessionSummary, 201);
    switch (filed.error.kind) {
      case "nowhere":
        return apiError(c, {
          status: 409,
          error: "There's no code workspace on Courtyard's own repository to file it in.",
        });
      case "session":
        return sessionError(c, filed.error.error);
    }
  });

  return routes;
};
