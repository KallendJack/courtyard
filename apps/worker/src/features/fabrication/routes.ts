import {
  type BuildChanged,
  BuildParametersChange,
  BuildSlug,
  type Builds,
  type BuildView,
} from "@courtyard/contract";
import { type Context, Hono } from "hono";
import { apiError, readBody } from "../../lib/http.ts";
import type { WholeFilesUndoRefusal } from "../context-folder/index.ts";
import type { PlanningFilesTarget } from "../planning-files/index.ts";
import {
  fileIn,
  type PlanningFiles,
  sharedFileError,
  workspaceIn,
} from "../planning-files/routes.ts";
import { type BuildRefusal, readBuild, readBuilds, saveBuild, viewOf } from "./index.ts";

// Fabrication's API (ADR 0037, #697): what the Fabrication app calls, never Courtyard's own
// workspace or session routes, so a standalone Fabrication could answer the same with its own
// storage. Courtyard backs it with a planning workspace's Builds.

const BUILDS: PlanningFiles = { one: "Build", many: "Builds" };

/** Why a Build wasn't read or saved, as the API answers it. */
const buildError = (c: Context, refusal: BuildRefusal) => {
  switch (refusal.kind) {
    case "workspace":
    case "code-workspace":
    case "not-found":
    case "storage":
      return sharedFileError(c, refusal, BUILDS);
    case "invalid":
      return apiError(c, { status: 400, error: refusal.problem });
    case "parameters":
      return apiError(c, {
        status: 400,
        error: `Those parameters can't be worked out: ${refusal.problems.join("; ")}`,
      });
    case "incomplete":
      return apiError(c, {
        status: 400,
        error: "Give the Build a name, a template and its parameters.",
      });
    case "clash":
      return apiError(c, { status: 409, error: `There's already a Build called ${refusal.name}.` });
    case "unreadable":
      return apiError(c, {
        status: 409,
        error: `${refusal.path} can't be read as a Build: ${refusal.problem}`,
      });
    case "unchanged":
      return apiError(c, { status: 400, error: "That changes nothing." });
    case "stale":
      return apiError(c, { status: 409, error: "That Build has changed since." });
  }
};

/** Why Undo of a Build's change wasn't done, from its note or Recent changes, as the API answers it. */
export const buildUndoError = (c: Context, refusal: WholeFilesUndoRefusal) =>
  refusal.kind === "changed-since"
    ? apiError(c, {
        status: 409,
        error: "That Build has changed since, so undoing this would lose the newer change.",
      })
    : sharedFileError(c, refusal, BUILDS);

/** Fabrication's routes under `/api/fabrication`. */
export const fabricationRoutes = (
  target: Pick<PlanningFilesTarget, "contextDir" | "contextFolder"> & { now: () => number },
) => {
  const routes = new Hono();
  const { now, ...where } = target;

  // A workspace's Builds, by name, and the files that can't be read as one.
  routes.get("/workspaces/:id/builds", async (c) => {
    const workspace = workspaceIn(c, where);
    if (workspace === undefined) return sharedFileError(c, { kind: "not-found" }, BUILDS);
    const read = await readBuilds(workspace);
    if (!read.ok) return buildError(c, read.error);
    return c.json({
      builds: read.value.builds.map(({ summary }) => summary),
      problems: [...read.value.problems],
    } satisfies Builds);
  });

  // One Build with everything its engine derives, worked out now.
  routes.get("/workspaces/:id/builds/:slug", async (c) => {
    const named = fileIn(c, where, BuildSlug);
    if (named === undefined) return sharedFileError(c, { kind: "not-found" }, BUILDS);
    const read = await readBuild(named.workspace, named.slug);
    if (!read.ok) return buildError(c, read.error);
    return c.json(viewOf(read.value) satisfies BuildView);
  });

  // The owner's own change to a Build's parameters, as a merge patch, worked out again.
  routes.patch("/workspaces/:id/builds/:slug/parameters", async (c) => {
    const named = fileIn(c, where, BuildSlug);
    if (named === undefined) return sharedFileError(c, { kind: "not-found" }, BUILDS);
    const body = await readBody(c, BuildParametersChange);
    if (!body.ok) return apiError(c, { status: 400, error: body.error });
    const saved = await saveBuild(
      named.workspace,
      { slug: named.slug, parameters: body.value.parameters },
      { now: now() },
    );
    if (!saved.ok) return buildError(c, saved.error);
    return c.json({
      change: saved.value.change ?? null,
      build: viewOf(saved.value.build),
    } satisfies BuildChanged);
  });

  return routes;
};
