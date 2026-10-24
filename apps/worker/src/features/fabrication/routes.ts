import {
  type BuildChanged,
  BuildParametersChange,
  BuildSlug,
  type Builds,
  type BuildView,
  ToolsChange,
  type ToolsHeard,
  ToolsSaid,
  type ToolsSaved,
  ToolsUndo,
  type YourTools,
} from "@courtyard/contract";
import { type Context, Hono } from "hono";
import { apiError, readBody } from "../../lib/http.ts";
import type { Provider } from "../../providers/index.ts";
import type { WholeFilesUndoRefusal } from "../context-folder/index.ts";
import type { PlanningFilesTarget } from "../planning-files/index.ts";
import {
  fileIn,
  type PlanningFiles,
  sharedFileError,
  workspaceIn,
} from "../planning-files/routes.ts";
import { type BuildRefusal, readBuild, readBuilds, saveBuild, viewOf } from "./index.ts";
import { hearTools, saveTools, type ToolsRefusal, undoToolsSave, yourTools } from "./tools.ts";

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

/** Why the owner's tools weren't read or saved, as the API answers it. */
const toolsError = (c: Context, refusal: ToolsRefusal) => {
  switch (refusal.kind) {
    case "invalid":
      return apiError(c, { status: 400, error: refusal.problem });
    case "twice":
      return apiError(c, {
        status: 400,
        error: `${refusal.name} is there twice: give each tool once.`,
      });
    case "unchanged":
      return apiError(c, { status: 400, error: "That changes nothing." });
    case "gone":
      return apiError(c, {
        status: 409,
        error: `${refusal.workspace} has no Thing ${refusal.thing} to move any more: tick your tools again.`,
      });
    case "has-parts":
      return apiError(c, {
        status: 409,
        error: `${refusal.name} has parts, so it stays where it is: untick it, or add it as your own.`,
      });
    case "storage":
      return apiError(c, { status: 500, error: "Your tools couldn't be read or saved just now." });
  }
};

/** Why Undo of a save of the owner's tools wasn't done, as the API answers it. */
const toolsUndoError = (c: Context, refusal: WholeFilesUndoRefusal) => {
  switch (refusal.kind) {
    case "not-found":
    case "not-undoable":
      return apiError(c, { status: 404, error: "There's no such save of your tools to undo." });
    case "already-undone":
      return apiError(c, { status: 409, error: "That's undone already." });
    case "changed-since":
      return apiError(c, {
        status: 409,
        error: "Your tools have changed since, so undoing this would lose the newer change.",
      });
    case "storage":
      return apiError(c, { status: 500, error: "Your tools couldn't be read or saved just now." });
  }
};

/** Fabrication's routes under `/api/fabrication`. */
export const fabricationRoutes = (
  target: Pick<PlanningFilesTarget, "contextDir" | "contextFolder"> & {
    now: () => number;
    /** The models that tick Your tools from what the owner said. */
    providers: readonly Provider[];
  },
) => {
  const routes = new Hono();
  const { now, providers, ...where } = target;

  // The owner's tools (#707): every Build's and every workspace's, with what to move.
  routes.get("/tools", async (c) => {
    const read = await yourTools(where.contextDir);
    if (!read.ok) return toolsError(c, read.error);
    return c.json(read.value satisfies YourTools);
  });

  // Your tools' Save: every tool the owner has now, as one change.
  routes.put("/tools", async (c) => {
    const body = await readBody(c, ToolsChange);
    if (!body.ok) return apiError(c, { status: 400, error: body.error });
    const saved = await saveTools(where, body.value.tools);
    if (!saved.ok) return toolsError(c, saved.error);
    const read = await yourTools(where.contextDir);
    if (!read.ok) return toolsError(c, read.error);
    return c.json({ change: saved.value.change ?? null, tools: read.value } satisfies ToolsSaved);
  });

  routes.post("/tools/undo", async (c) => {
    const body = await readBody(c, ToolsUndo);
    if (!body.ok) return apiError(c, { status: 400, error: body.error });
    const undone = await undoToolsSave(where, body.value.change);
    if (!undone.ok) return toolsUndoError(c, undone.error);
    return c.body(null, 204);
  });

  // "Or just say it": the tools a model heard, ticked for the owner to check, saving nothing.
  routes.post("/tools/heard", async (c) => {
    const body = await readBody(c, ToolsSaid);
    if (!body.ok) return apiError(c, { status: 400, error: body.error });
    const heard = await hearTools(providers, body.value.said);
    if (heard === undefined) {
      return apiError(c, {
        status: 503,
        error: "No model could listen just now: tick your tools instead.",
      });
    }
    return c.json(heard satisfies ToolsHeard);
  });

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
