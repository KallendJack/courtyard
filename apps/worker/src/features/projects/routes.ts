import { type ProjectDecided, ProjectDecision, ProjectSlug } from "@courtyard/contract";
import { type Context, Hono } from "hono";
import { apiError, readBody } from "../../lib/http.ts";
import type { WholeFilesUndoRefusal } from "../context-folder/index.ts";
import type { PlanningFilesTarget } from "../planning-files/index.ts";
import { fileIn, type PlanningFiles, sharedFileError } from "../planning-files/routes.ts";
import { type ProjectRefusal, saveProject } from "./index.ts";

// A project's one route of its own (#603): a decision picked on an options block. Home carries the
// projects, a session starts from one, and their saves are undone from their notes and Recent
// changes; this is also how those answer a refusal.

const PROJECTS: PlanningFiles = { one: "project", many: "projects" };

/** Why a project wasn't found, saved or undone, as the API answers it. */
export const projectError = (c: Context, refusal: ProjectRefusal | WholeFilesUndoRefusal) => {
  switch (refusal.kind) {
    case "workspace":
    case "code-workspace":
    case "not-found":
    case "not-undoable":
    case "already-undone":
    case "storage":
      return sharedFileError(c, refusal, PROJECTS);
    case "invalid":
      return apiError(c, { status: 400, error: refusal.problem });
    case "incomplete":
      return apiError(c, { status: 400, error: "Give the project a name." });
    case "clash":
      return apiError(c, {
        status: 409,
        error: `There's already a project called ${refusal.name}. Choose another name.`,
      });
    case "unreadable":
      return apiError(c, {
        status: 409,
        error: `${refusal.path} can't be read as a project, so it can't be changed here: ${refusal.problem}`,
      });
    case "no-such-step":
      return apiError(c, { status: 400, error: "That step isn't there any more." });
    case "unchanged":
      return apiError(c, { status: 400, error: "That changes nothing." });
    case "stale":
    case "changed-since":
      return apiError(c, {
        status: 409,
        error: "That project has changed since, so this would lose the newer change.",
      });
  }
};

/** A project's routes under `/api`. */
export const projectRoutes = (
  target: Pick<PlanningFilesTarget, "contextDir" | "contextFolder"> & { now: () => number },
) => {
  const routes = new Hono();
  const { now, ...where } = target;

  // Pick on an options block in a session that belongs to the project (#603): its decision, with
  // the options, the pick and why, as the model's tool records one. The owner's own change.
  routes.put("/workspaces/:id/projects/:slug/decision", async (c) => {
    const named = fileIn(c, where, ProjectSlug);
    if (named === undefined) return sharedFileError(c, { kind: "not-found" }, PROJECTS);
    const body = await readBody(c, ProjectDecision);
    if (!body.ok) return apiError(c, { status: 400, error: body.error });
    const saved = await saveProject(
      named.workspace,
      { slug: named.slug, decision: body.value },
      { now: now() },
    );
    if (!saved.ok) return projectError(c, saved.error);
    return c.json({
      change: saved.value.change ?? null,
      project: saved.value.project,
    } satisfies ProjectDecided);
  });

  return routes;
};
