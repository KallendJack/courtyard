import {
  type FailureReason,
  TidyId,
  type TidyProposal,
  TidyRequest,
  TidySave,
} from "@courtyard/contract";
import { type Context, Hono } from "hono";
import type { Place } from "../context-folder/index.ts";
import { apiError, contextError, readBody } from "../http.ts";
import { getWorkspace } from "../workspaces/index.ts";
import type { Tidying, TidyRefusal } from "./index.ts";

/** Why the model gave no tidy, in the owner's words. */
const failedBecause = (reason: FailureReason) => {
  switch (reason.kind) {
    case "rate-limited":
      return "The model's usage limit is reached, so it can't tidy right now. Try again later.";
    case "provider-unavailable":
    case "unknown":
      return reason.message;
    case "interrupted":
      return "The worker stopped before the tidy was ready. Try again.";
  }
};

const refused = (c: Context, refusal: TidyRefusal) => {
  switch (refusal.kind) {
    case "model-unavailable":
      return apiError(c, { status: 400, error: "That model isn't available right now." });
    case "failed":
      return apiError(c, { status: 502, error: failedBecause(refusal.reason) });
    case "not-found":
      return apiError(c, {
        status: 404,
        error: "This tidy has gone, perhaps because the worker restarted. Tidy again.",
      });
    case "changed-since":
      return apiError(c, {
        status: 409,
        error:
          "This file changed since the tidy was proposed, so nothing was saved. Tidy again for a fresh list.",
      });
    case "storage":
      return apiError(c, {
        status: 500,
        error: "The context file or the owner context can't be read or written.",
      });
  }
};

/** Tidy for each workspace's context file and the owner context, under `/api`. */
export const tidyRoutes = (options: { contextDir: string; tidying: Tidying }) => {
  const { contextDir, tidying } = options;
  const routes = new Hono();

  /** Proposes a tidy of a place's file. It waits for the model, so it can take a minute. */
  const propose = async (c: Context, place: Place) => {
    const body = await readBody(c, TidyRequest);
    if (!body.ok) return apiError(c, { status: 400, error: body.error });
    const proposal = await tidying.propose({
      place,
      model: body.value.model,
      signal: c.req.raw.signal,
    });
    return proposal.ok ? c.json(proposal.value satisfies TidyProposal) : refused(c, proposal.error);
  };

  routes.post("/workspaces/:id/tidy", async (c) => {
    const workspace = await getWorkspace(contextDir, c.req.param("id"));
    if (!workspace.ok) return contextError(c, workspace.error);
    return propose(c, { kind: "workspace", id: workspace.value.summary.id });
  });

  routes.post("/owner-context/tidy", (c) => propose(c, { kind: "owner-context" }));

  routes.post("/tidies/:id/save", async (c) => {
    const id = TidyId.safeParse(c.req.param("id"));
    if (!id.success) return refused(c, { kind: "not-found" });
    const body = await readBody(c, TidySave);
    if (!body.ok) return apiError(c, { status: 400, error: body.error });
    const saved = await tidying.save({ id: id.data, keep: body.value.keep });
    return saved.ok ? c.body(null, 204) : refused(c, saved.error);
  });

  return routes;
};
