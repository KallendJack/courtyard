import {
  type BuildSizes,
  BuildSlug,
  ChangeId,
  OldSizesConfirm,
  SizeAdd,
  SizeCorrection,
  SizeKeep,
  SizeRecordId,
  type Sizes,
  type SpaceChanged,
  type SpaceSizes,
  ThingSlug,
} from "@courtyard/contract";
import { type Context, Hono } from "hono";
import { apiError, contextError, readBody } from "../../../lib/http.ts";
import type { WholeFilesUndoRefusal } from "../../context-folder/index.ts";
import type { PlanningFilesTarget } from "../../planning-files/index.ts";
import {
  fileIn,
  type PlanningFiles,
  sharedFileError,
  workspaceIn,
} from "../../planning-files/routes.ts";
import { readThings } from "../../things/index.ts";
import { getWorkspace } from "../../workspaces/index.ts";
import { readSizes, type SizeEdit, saveSizes, sizeRows, undoSizeChange, valueText } from "./index.ts";
import { buildSizes, confirmOldSizes, ownerEdit, readSpace, type SpaceRefusal } from "./space.ts";

// Fabrication's sizes (ADR 0037, #708): a workspace's size records, which every project in it uses
// for its spaces and Things, each with its Thing and the records it conflicts with; and a space's
// sizes as its room's Things panel shows them (#709), corrected, settled and confirmed there.

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

/** Why a space's sizes weren't read or saved, as the API answers it. */
const spaceError = (c: Context, refusal: SpaceRefusal) => {
  switch (refusal.kind) {
    case "workspace":
    case "code-workspace":
    case "storage":
      return sharedFileError(c, refusal, SIZES);
    case "no-space":
      return apiError(c, { status: 404, error: "No such space." });
    case "no-thing":
    case "not-found":
      return apiError(c, { status: 404, error: "No such size." });
    case "invalid":
      return apiError(c, { status: 400, error: refusal.problem });
    case "unreadable":
      return apiError(c, {
        status: 409,
        error: `${refusal.path} isn't a size record as written, so it can't be corrected here.`,
      });
    case "unchanged":
      return apiError(c, {
        status: 409,
        error: `It's recorded already as ${valueText(refusal.size.record.value)}.`,
      });
    case "stale":
      return apiError(c, {
        status: 409,
        error: "That size has been corrected since: here it is as it is now.",
      });
    case "old-sizes-changed":
      return apiError(c, {
        status: 409,
        error: "The old sizes have changed since they were listed: here they are again.",
      });
  }
};

/** Fabrication's size routes, under `/api/fabrication`. */
export const sizeRoutes = (
  target: Pick<PlanningFilesTarget, "contextDir" | "contextFolder"> & { now: () => number },
) => {
  const routes = new Hono();
  const { now, ...where } = target;

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

  /** The space a request's path names, as its page shows it, and where it is. */
  const space = async (c: Context) => {
    const named = fileIn(c, where, ThingSlug);
    if (named === undefined) return { answer: apiError(c, { status: 404, error: "No such space." }) };
    const workspace = await getWorkspace(where.contextDir, named.workspace.workspaceId);
    if (!workspace.ok) return { answer: contextError(c, workspace.error) };
    const { id, name } = workspace.value.summary;
    const view = async () => {
      const read = await readSpace(named.workspace, { id, name }, named.slug);
      return read.ok ? c.json(read.value satisfies SpaceSizes) : spaceError(c, read.error);
    };
    /** The space now, after a change. */
    const changed = async (change: ChangeId | undefined) => {
      const read = await readSpace(named.workspace, { id, name }, named.slug);
      if (!read.ok) return spaceError(c, read.error);
      return c.json({ change: change ?? null, sizes: read.value } satisfies SpaceChanged);
    };
    /** Edits saved as one change, then the space now. */
    const save = async (edits: SizeEdit[]) => {
      const saved = await saveSizes(named.workspace, edits, { now: now() });
      return saved.ok ? changed(saved.value.change) : spaceError(c, saved.error);
    };
    return { named, view, changed, save };
  };

  // A space's sizes (#709): its own and its Things', what it needs, and old sizes to confirm.
  routes.get("/workspaces/:id/spaces/:slug", async (c) => {
    const opened = await space(c);
    return "answer" in opened ? opened.answer : opened.view();
  });

  // + Size: a new size of the space or a Thing in it.
  routes.post("/workspaces/:id/spaces/:slug/sizes", async (c) => {
    const opened = await space(c);
    if ("answer" in opened) return opened.answer;
    const body = await readBody(c, SizeAdd);
    if (!body.ok) return apiError(c, { status: 400, error: body.error });
    return opened.save([ownerEdit({ kind: "add", ...body.value }, now())]);
  });

  // A size tapped and corrected: a record of its own, the next revision.
  routes.post("/workspaces/:id/spaces/:slug/sizes/:size", async (c) => {
    const opened = await space(c);
    if ("answer" in opened) return opened.answer;
    const id = SizeRecordId.safeParse(c.req.param("size"));
    if (!id.success) return apiError(c, { status: 404, error: "No such size." });
    const body = await readBody(c, SizeCorrection);
    if (!body.ok) return apiError(c, { status: 400, error: body.error });
    return opened.save([ownerEdit({ kind: "correct", id: id.data, ...body.value }, now())]);
  });

  // Two answers settled: each other record corrected to the one kept, as one change.
  routes.post("/workspaces/:id/spaces/:slug/sizes/:size/keep", async (c) => {
    const opened = await space(c);
    if ("answer" in opened) return opened.answer;
    const id = SizeRecordId.safeParse(c.req.param("size"));
    if (!id.success) return apiError(c, { status: 404, error: "No such size." });
    const body = await readBody(c, SizeKeep);
    if (!body.ok) return apiError(c, { status: 400, error: body.error });
    const read = await readSizes(opened.named.workspace);
    if (!read.ok) return spaceError(c, read.error);
    const kept = read.value.sizes.find(({ record }) => record.id === id.data)?.record;
    if (kept === undefined) return spaceError(c, { kind: "not-found", id: id.data });
    return opened.save(
      body.value.others.map((other) => ({
        kind: "correct",
        id: other.id,
        revision: other.revision,
        value: kept.value,
        source: kept.source,
        observed: kept.observed,
      })),
    );
  });

  // The old sizes confirmed, once: those picked recorded, the space marked confirmed.
  routes.post("/workspaces/:id/spaces/:slug/old-sizes", async (c) => {
    const opened = await space(c);
    if ("answer" in opened) return opened.answer;
    const body = await readBody(c, OldSizesConfirm);
    if (!body.ok) return apiError(c, { status: 400, error: body.error });
    const saved = await confirmOldSizes(opened.named.workspace, opened.named.slug, body.value, {
      now: now(),
    });
    return saved.ok ? opened.changed(saved.value.change) : spaceError(c, saved.error);
  });

  // Undo of one of its sizes' changes, from Fabrication: the space as it is again.
  routes.post("/workspaces/:id/spaces/:slug/changes/:change/undo", async (c) => {
    const opened = await space(c);
    if ("answer" in opened) return opened.answer;
    const id = ChangeId.safeParse(c.req.param("change"));
    if (!id.success) return sharedFileError(c, { kind: "not-found" }, SIZES);
    const undone = await undoSizeChange(opened.named.workspace, id.data);
    if (!undone.ok) return sizeUndoError(c, undone.error);
    return opened.view();
  });

  // The sizes a Build's steps need, as its space shows them.
  routes.get("/workspaces/:id/builds/:slug/sizes", async (c) => {
    const named = fileIn(c, where, BuildSlug);
    if (named === undefined) return sharedFileError(c, { kind: "not-found" }, SIZES);
    const read = await buildSizes(named.workspace, named.slug);
    if (!read.ok) return spaceError(c, read.error);
    return c.json({ spaces: read.value } satisfies BuildSizes);
  });

  return routes;
};
