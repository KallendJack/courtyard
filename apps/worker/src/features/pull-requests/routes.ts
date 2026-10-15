import {
  type OpenPullRequestList,
  PullRequestMerging,
  type PullRequestReview,
  PullRequestSessionStart,
  type SessionSummary,
} from "@courtyard/contract";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { apiError, contextError, readBody } from "../../lib/http.ts";
import { sessionError } from "../sessions/routes.ts";
import type { PullRequests, PullRequestsProblem } from "./index.ts";

/** A pull request's number in a path; anything else names none. */
export const PullNumber = z.coerce.number().int().positive().catch(0);

/** Why a workspace's pull request couldn't be listed, shown or acted on, as the API answers it. */
export const pullRequestsProblem = (c: Context, problem: PullRequestsProblem) => {
  switch (problem.kind) {
    case "workspace":
      return contextError(c, problem.error);
    case "not-code":
      return apiError(c, {
        status: 409,
        error: "Only a code workspace has pull requests.",
      });
    case "no-such-pull-request":
      return apiError(c, { status: 404, error: "No such pull request on this repository." });
    case "has-session":
      return apiError(c, {
        status: 409,
        error: "A session is on this pull request already: ask it from its page.",
      });
    case "fork":
      return apiError(c, {
        status: 409,
        error: "It comes from a fork, so a session can't work on its branch here.",
      });
    case "session":
      return sessionError(c, problem.error);
  }
};

/** A code workspace's pull requests, whoever opened them (#278), mounted under `/api`. */
export const pullRequestRoutes = (pullRequests: PullRequests) => {
  const routes = new Hono();

  routes.get("/workspaces/:id/pull-requests", async (c) => {
    const listed = await pullRequests.list(c.req.param("id"));
    if (!listed.ok) return pullRequestsProblem(c, listed.error);
    return c.json({ pullRequests: listed.value } satisfies OpenPullRequestList);
  });

  routes.get("/workspaces/:id/pull-requests/:number", async (c) => {
    const review = await pullRequests.review(
      c.req.param("id"),
      PullNumber.parse(c.req.param("number")),
    );
    if (!review.ok) return pullRequestsProblem(c, review.error);
    return c.json(review.value satisfies PullRequestReview);
  });

  routes.post("/workspaces/:id/pull-requests/:number/merge", async (c) => {
    const body = await readBody(c, PullRequestMerging);
    if (!body.ok) return apiError(c, { status: 400, error: body.error });
    const merged = await pullRequests.merge(
      c.req.param("id"),
      PullNumber.parse(c.req.param("number")),
      body.value.head,
    );
    if (!merged.ok) return pullRequestsProblem(c, merged.error);
    return c.body(null, 204);
  });

  routes.post("/workspaces/:id/pull-requests/:number/close", async (c) => {
    const closed = await pullRequests.close(
      c.req.param("id"),
      PullNumber.parse(c.req.param("number")),
    );
    if (!closed.ok) return pullRequestsProblem(c, closed.error);
    return c.body(null, 204);
  });

  // A session on the branch of a pull request no session opened, from its page's ask line or
  // Bring up to date.
  routes.post("/workspaces/:id/pull-requests/:number/sessions", async (c) => {
    const body = await readBody(c, PullRequestSessionStart);
    if (!body.ok) return apiError(c, { status: 400, error: body.error });
    const started = await pullRequests.startSession(
      c.req.param("id"),
      PullNumber.parse(c.req.param("number")),
      body.value,
    );
    if (!started.ok) return pullRequestsProblem(c, started.error);
    return c.json(started.value satisfies SessionSummary, 201);
  });

  return routes;
};
