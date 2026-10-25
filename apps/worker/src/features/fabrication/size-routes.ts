import type { Sizes } from "@courtyard/contract";
import { type Context, Hono } from "hono";
import { apiError } from "../../lib/http.ts";
import type { WholeFilesUndoRefusal } from "../context-folder/index.ts";
import type { PlanningFilesTarget } from "../planning-files/index.ts";
import { type PlanningFiles, sharedFileError, workspaceIn } from "../planning-files/routes.ts";
import { readThings } from "../things/index.ts";
import { readSizes, sizeRows } from "./sizes.ts";

// Fabrication's sizes (ADR 0037, #708): a workspace's size records, which every project in it uses
// for its spaces and Things, each with its Thing and the records it conflicts with.

const SIZES: PlanningFiles = { one: "size", many: "sizes" };

/** Why Undo of a size's change wasn't done, from its note or Recent changes, as the API answers it. */
export const sizeUndoError = (c: Context, refusal: WholeFilesUndoRefusal) =>
  refusal.kind === "changed-since"
    ? apiError(c, {
        status: 409,
        error:
          "That size has been corrected or changed since, so undoing this would lose the newer one.",
      })
    : sharedFileError(c, refusal, SIZES);

/** Fabrication's size routes, under `/api/fabrication`. */
export const sizeRoutes = (where: Pick<PlanningFilesTarget, "contextDir">) => {
  const routes = new Hono();

  // A workspace's size records, oldest first, and the files that can't be read as one.
  routes.get("/workspaces/:id/sizes", async (c) => {
    const workspace = workspaceIn(c, where);
    if (workspace === undefined) return sharedFileError(c, { kind: "not-found" }, SIZES);
    const [read, things] = await Promise.all([readSizes(workspace), readThings(workspace)]);
    if (!read.ok) {
      return read.error.kind === "workspace" || read.error.kind === "code-workspace"
        ? sharedFileError(c, read.error, SIZES)
        : sharedFileError(c, { kind: "storage" }, SIZES);
    }
    if (!things.ok) return sharedFileError(c, { kind: "storage" }, SIZES);
    return c.json({
      sizes: sizeRows(read.value.sizes, things.value.things),
      problems: [...read.value.problems],
    } satisfies Sizes);
  });

  return routes;
};
