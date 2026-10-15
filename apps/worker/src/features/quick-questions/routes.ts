import {
  type FailureReason,
  PullRequestFix,
  type PullRequestFixed,
  QuickQuestion,
  type QuickQuestions,
} from "@courtyard/contract";
import { type Context, Hono } from "hono";
import { apiError, readBody } from "../../lib/http.ts";
import { PullNumber, pullRequestsProblem } from "../pull-requests/routes.ts";
import type { QuickQuestionsKeeper, QuickQuestionsProblem } from "./index.ts";

/** Why the model gave no answer, in the owner's words. */
const failedBecause = (reason: FailureReason) => {
  switch (reason.kind) {
    case "rate-limited":
      return "The model's usage limit is reached, so it can't answer right now. Try again later.";
    case "provider-unavailable":
    case "unknown":
      return reason.message;
    case "interrupted":
      return "The worker stopped before the answer came. Ask again.";
  }
};

const problem = (c: Context, why: QuickQuestionsProblem) => {
  switch (why.kind) {
    case "pull-requests":
      return pullRequestsProblem(c, why.problem);
    case "model-unavailable":
      return apiError(c, { status: 400, error: "That model isn't available right now." });
    case "busy":
      return apiError(c, {
        status: 409,
        error: "A question about it is being answered: ask once its answer comes.",
      });
    case "failed":
      return apiError(c, { status: 502, error: failedBecause(why.reason) });
    case "nothing-asked":
      return apiError(c, {
        status: 409,
        error: "Nothing has been asked about it yet, so there's nothing to carry over.",
      });
  }
};

/** Quick questions about a code workspace's pull requests (#327), mounted under `/api`. */
export const quickQuestionRoutes = (questions: QuickQuestionsKeeper) => {
  const routes = new Hono();
  const numberOf = (c: Context) => PullNumber.parse(c.req.param("number"));

  routes.get("/workspaces/:id/pull-requests/:number/questions", async (c) => {
    const asked = await questions.of(c.req.param("id"), numberOf(c));
    return asked.ok ? c.json(asked.value satisfies QuickQuestions) : problem(c, asked.error);
  });

  // It waits for the model's answer, so it can take a minute.
  routes.post("/workspaces/:id/pull-requests/:number/questions", async (c) => {
    const body = await readBody(c, QuickQuestion);
    if (!body.ok) return apiError(c, { status: 400, error: body.error });
    const asked = await questions.ask({
      rawId: c.req.param("id"),
      number: numberOf(c),
      text: body.value.text,
      model: body.value.model,
      signal: c.req.raw.signal,
    });
    return asked.ok ? c.json(asked.value satisfies QuickQuestions) : problem(c, asked.error);
  });

  routes.post("/workspaces/:id/pull-requests/:number/fix", async (c) => {
    const body = await readBody(c, PullRequestFix);
    if (!body.ok) return apiError(c, { status: 400, error: body.error });
    const fixed = await questions.fix(c.req.param("id"), numberOf(c), body.value);
    if (!fixed.ok) return problem(c, fixed.error);
    return c.json(fixed.value satisfies PullRequestFixed, fixed.value.started ? 201 : 200);
  });

  return routes;
};
