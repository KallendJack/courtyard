import { ChangeId, type RecentChanges } from "@courtyard/contract";
import { type Context, Hono } from "hono";
import type { Place } from "../context-folder/index.ts";
import { apiError, contextError } from "../http.ts";
import { sessionError } from "../sessions/routes.ts";
import { getWorkspace } from "../workspaces/index.ts";
import { type ChangesTarget, type ChangeUndoRefusal, listChanges, undoChange } from "./index.ts";

const undoRefused = (c: Context, refusal: ChangeUndoRefusal) => {
  switch (refusal.kind) {
    case "not-found":
      return apiError(c, { status: 404, error: "No such change." });
    case "not-undoable":
      return apiError(c, { status: 409, error: "This change can't be undone from here." });
    case "changed-since":
      return apiError(c, {
        status: 409,
        error: "A line it changed has changed since, so undoing it would lose the newer wording.",
      });
    case "session":
      return sessionError(c, refusal.error);
    case "storage":
      return apiError(c, {
        status: 500,
        error: "The context file or the owner context can't be read or written.",
      });
  }
};

/** Recent changes for each workspace and the owner context, and Undo from them, under `/api`. */
export const changeRoutes = (target: ChangesTarget) => {
  const routes = new Hono();

  /** A page of a place's changes, after the change the `after` query names, if it does. */
  const list = async (c: Context, place: Place) => {
    const raw = c.req.query("after");
    const after = raw === undefined ? undefined : ChangeId.safeParse(raw);
    if (after !== undefined && !after.success) {
      return apiError(c, { status: 400, error: "That isn't a change." });
    }
    const listed = await listChanges(target, {
      place,
      ...(after === undefined ? {} : { after: after.data }),
    });
    if (!listed.ok) {
      return listed.error === "unknown-change"
        ? apiError(c, { status: 404, error: "No such change." })
        : apiError(c, { status: 500, error: "The context folder's history can't be read." });
    }
    return c.json(listed.value satisfies RecentChanges);
  };

  routes.get("/workspaces/:id/changes", async (c) => {
    const workspace = await getWorkspace(target.contextDir, c.req.param("id"));
    if (!workspace.ok) return contextError(c, workspace.error);
    return list(c, { kind: "workspace", id: workspace.value.summary.id });
  });

  routes.get("/owner-context/changes", (c) => list(c, { kind: "owner-context" }));

  routes.post("/changes/:id/undo", async (c) => {
    const id = ChangeId.safeParse(c.req.param("id"));
    if (!id.success) return apiError(c, { status: 404, error: "No such change." });
    const undone = await undoChange(target, id.data);
    return undone.ok ? c.body(null, 204) : undoRefused(c, undone.error);
  });

  return routes;
};
