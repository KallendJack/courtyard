import { MovesMade, MoveTicks } from "@courtyard/contract";
import { Hono } from "hono";
import { apiError, contextError, readBody } from "../../lib/http.ts";
import { workspaceIn } from "../planning-files/routes.ts";
import type { MoveReviews } from "./index.ts";

/** The move review's one route under `/api` (#603): the owner's ticks. Home carries the review. */
export const moveReviewRoutes = (reviews: MoveReviews) => {
  const routes = new Hono();

  routes.post("/workspaces/:id/review", async (c) => {
    const workspace = workspaceIn(c, {});
    if (workspace === undefined) return contextError(c, { kind: "not-found" });
    const body = await readBody(c, MoveTicks);
    if (!body.ok) return apiError(c, { status: 400, error: body.error });
    const made = await reviews.move(workspace.workspaceId, body.value.moves);
    if (made.ok) return c.json(MovesMade.parse(made.value));
    return made.error === "no-review"
      ? apiError(c, { status: 409, error: "There's nothing waiting to move here any more." })
      : apiError(c, { status: 500, error: "The move review couldn't be kept just now." });
  });

  return routes;
};
