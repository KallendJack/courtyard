import { BuildIssue, type NextUp, type SessionSummary } from "@courtyard/contract";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { gitHubProblem } from "../github/routes.ts";
import { apiError, contextError, readBody } from "../http.ts";
import { sessionError } from "../sessions/routes.ts";
import type { NextUp as NextUpModule, NextUpProblem } from "./index.ts";

/** An issue's number in a path; anything else names none. */
const IssueNumber = z.coerce.number().int().positive().catch(0);

/** Why a workspace's Next up couldn't be read, or an issue built, as the API answers it. */
const nextUpProblem = (c: Context, problem: NextUpProblem) => {
  switch (problem.kind) {
    case "workspace":
      return contextError(c, problem.error);
    case "not-code":
      return apiError(c, { status: 409, error: "Only a code workspace has Next up." });
    case "not-on-github":
      return apiError(c, {
        status: 409,
        error: "This code workspace's repository isn't on GitHub, so its issues aren't either.",
      });
    case "github":
      return gitHubProblem(c, problem.problem);
    case "no-such-issue":
      return apiError(c, { status: 404, error: "That issue isn't ready to build any more." });
    case "claimed":
      return apiError(c, {
        status: 409,
        error: "Someone has claimed that issue since: it's being built already.",
      });
    case "session":
      return sessionError(c, problem.error);
  }
};

/** A code workspace's Next up and Build (#301, #298), mounted under `/api`. */
export const nextUpRoutes = (nextUp: NextUpModule) => {
  const routes = new Hono();

  routes.get("/workspaces/:id/next-up", async (c) => {
    const listed = await nextUp.list(c.req.param("id"));
    if (!listed.ok) return nextUpProblem(c, listed.error);
    return c.json({ issues: listed.value } satisfies NextUp);
  });

  routes.post("/workspaces/:id/next-up/:number/build", async (c) => {
    const body = await readBody(c, BuildIssue);
    if (!body.ok) return apiError(c, { status: 400, error: body.error });
    const built = await nextUp.build(
      c.req.param("id"),
      IssueNumber.parse(c.req.param("number")),
      body.value,
    );
    if (!built.ok) return nextUpProblem(c, built.error);
    return c.json(built.value satisfies SessionSummary, 201);
  });

  return routes;
};
