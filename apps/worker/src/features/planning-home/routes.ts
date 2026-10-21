import {
  HomeViewPick,
  type LastQuestion,
  type PlanningHome,
  type WorkspaceId,
} from "@courtyard/contract";
import { type Context, Hono } from "hono";
import { apiError, contextError, readBody } from "../../lib/http.ts";
import type { Result } from "../../lib/result.ts";
import { planViews } from "../floor-plans/index.ts";
import type { PlanningFilesTarget } from "../planning-files/index.ts";
import { workspaceIn } from "../planning-files/routes.ts";
import { readProjects } from "../projects/index.ts";
import { readThings } from "../things/index.ts";
import { thingError } from "../things/routes.ts";
import { type HomePicks, homeOf } from "./index.ts";

/** A planning workspace's Home (#208) and the owner's pick of its view, under `/api`. */
export const planningHomeRoutes = (target: {
  contextDir: PlanningFilesTarget["contextDir"];
  picks: HomePicks;
  /** The owner's last question in a workspace, and its next steps. */
  lastQuestion: (workspaceId: WorkspaceId) => Promise<Result<LastQuestion | null, unknown>>;
}) => {
  const routes = new Hono();
  const { contextDir, picks } = target;

  /** Home as it is now, or the answer refusing it. */
  const homeNow = async (c: Context, workspaceId: WorkspaceId) => {
    const read = await readThings({ contextDir, workspaceId });
    if (!read.ok) return { refused: thingError(c, read.error) };
    const question = await target.lastQuestion(workspaceId);
    if (!question.ok) {
      return { refused: apiError(c, { status: 500, error: "Its sessions can't be read." }) };
    }
    const things = read.value.things.map(({ summary }) => summary);
    // Documents that can't be read leave Home without plans, never without the rest.
    const plans = await planViews({ contextDir, workspaceId });
    // Its projects (#603); ones that can't be read leave Home without them, never without the rest.
    const projects = await readProjects({ contextDir, workspaceId });
    return {
      home: {
        ...homeOf(things, await picks.of(workspaceId), plans.ok ? plans.value : []),
        question: question.value,
        projects: projects.ok ? projects.value.projects.map(({ project }) => project) : [],
      } satisfies PlanningHome,
    };
  };

  routes.get("/workspaces/:id/home", async (c) => {
    const workspace = workspaceIn(c, {});
    if (workspace === undefined) return contextError(c, { kind: "not-found" });
    const now = await homeNow(c, workspace.workspaceId);
    return "refused" in now ? now.refused : c.json(now.home);
  });

  routes.put("/workspaces/:id/home/showing", async (c) => {
    const workspace = workspaceIn(c, {});
    if (workspace === undefined) return contextError(c, { kind: "not-found" });
    const body = await readBody(c, HomeViewPick);
    if (!body.ok) return apiError(c, { status: 400, error: body.error });
    const before = await homeNow(c, workspace.workspaceId);
    if ("refused" in before) return before.refused;
    if (!before.home.views.some(({ id }) => id === body.value.view)) {
      return apiError(c, {
        status: 404,
        error: "That view isn't on this workspace's Home any more.",
      });
    }
    const picked = await picks.pick(workspace.workspaceId, body.value.view);
    if (!picked.ok) return apiError(c, { status: 500, error: "The pick can't be kept." });
    return c.json({
      ...before.home,
      showing: body.value.view,
      picked: true,
    } satisfies PlanningHome);
  });

  return routes;
};
