import type { PlanningHome } from "@courtyard/contract";
import { Hono } from "hono";
import { contextError } from "../../lib/http.ts";
import { planSubjects } from "../floor-plans/index.ts";
import type { MoveReviews } from "../move-review/index.ts";
import type { PlanningFilesTarget } from "../planning-files/index.ts";
import { workspaceIn } from "../planning-files/routes.ts";
import { readProjects } from "../projects/index.ts";
import { readThings } from "../things/index.ts";
import { thingError } from "../things/routes.ts";
import { getWorkspace } from "../workspaces/index.ts";
import { spaceOf, subjectOf } from "./index.ts";

/**
 * A planning workspace's Home (#603): its main subject and its projects, or, once, its move review,
 * under `/api`.
 */
export const planningHomeRoutes = (target: {
  contextDir: PlanningFilesTarget["contextDir"];
  reviews: MoveReviews;
}) => {
  const routes = new Hono();
  const { contextDir, reviews } = target;

  routes.get("/workspaces/:id/home", async (c) => {
    const workspace = workspaceIn(c, {});
    if (workspace === undefined) return contextError(c, { kind: "not-found" });
    const { workspaceId } = workspace;
    const read = await readThings({ contextDir, workspaceId });
    if (!read.ok) return thingError(c, read.error);
    // Documents that can't be read leave Home without plans, never without the rest.
    const plans = await planSubjects({ contextDir, workspaceId });
    // Its projects; ones that can't be read leave Home without them, never without the rest.
    const projects = await readProjects({ contextDir, workspaceId });
    // A space to draw, from its facts (#604); a context file that can't be read gives none.
    const workspaceNow = await getWorkspace(contextDir, workspaceId);
    const space = workspaceNow.ok
      ? spaceOf({
          name: workspaceNow.value.summary.name,
          facts: workspaceNow.value.contextFile?.facts ?? [],
        })
      : null;
    return c.json({
      subject: subjectOf({
        name: workspaceNow.ok ? workspaceNow.value.summary.name : workspaceId,
        things: read.value.things.map(({ summary }) => summary),
        plans: plans.ok ? plans.value : [],
        space,
      }),
      projects: projects.ok ? projects.value.projects.map(({ project }) => project) : [],
      review: await reviews.shown(workspaceId),
    } satisfies PlanningHome);
  });

  return routes;
};
