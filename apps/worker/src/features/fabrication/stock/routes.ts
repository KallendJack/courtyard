import { HaveIt, type StockSaved, StockUndo } from "@courtyard/contract";
import { type Context, Hono } from "hono";
import { apiError, readBody } from "../../../lib/http.ts";
import type { WholeFilesUndoRefusal } from "../../context-folder/index.ts";
import type { ToolsTarget } from "../tools.ts";
import { type StockRefusal, saveHaveIt, undoHaveIt } from "./index.ts";

// Your stock's routes (#760), under `/api/fabrication`: Have it on a buy-list line, and its Undo.

const NOT_NOW = "Your stock couldn't be read or saved just now.";

const stockError = (c: Context, refusal: StockRefusal) => {
  switch (refusal.kind) {
    case "tool":
      return apiError(c, { status: 409, error: `${refusal.name} is one of your tools.` });
    case "invalid":
      return apiError(c, { status: 400, error: refusal.problem });
    case "unchanged":
      return apiError(c, { status: 400, error: "That changes nothing." });
    case "storage":
      return apiError(c, { status: 500, error: NOT_NOW });
  }
};

const undoError = (c: Context, refusal: WholeFilesUndoRefusal) => {
  switch (refusal.kind) {
    case "not-found":
    case "not-undoable":
      return apiError(c, { status: 404, error: "There's no such Have it to undo." });
    case "already-undone":
      return apiError(c, { status: 409, error: "That's undone already." });
    case "changed-since":
      return apiError(c, {
        status: 409,
        error: "Your stock has changed since, so undoing this would lose the newer change.",
      });
    case "storage":
      return apiError(c, { status: 500, error: NOT_NOW });
  }
};

/** Your stock's routes, under `/api/fabrication`. */
export const stockRoutes = (where: ToolsTarget) => {
  const routes = new Hono();

  routes.post("/stock", async (c) => {
    const body = await readBody(c, HaveIt);
    if (!body.ok) return apiError(c, { status: 400, error: body.error });
    const saved = await saveHaveIt(where, body.value);
    if (!saved.ok) return stockError(c, saved.error);
    return c.json({ change: saved.value.change ?? null } satisfies StockSaved);
  });

  routes.post("/stock/undo", async (c) => {
    const body = await readBody(c, StockUndo);
    if (!body.ok) return apiError(c, { status: 400, error: body.error });
    const undone = await undoHaveIt(where, body.value.change);
    if (!undone.ok) return undoError(c, undone.error);
    return c.body(null, 204);
  });

  return routes;
};
