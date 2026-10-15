import type { GitHubRepoList } from "@courtyard/contract";
import { type Context, Hono } from "hono";
import { gitHubProblem } from "../../integrations/github/routes.ts";
import { apiError, contextError } from "../../lib/http.ts";
import type { RepoProblem, Repos } from "./index.ts";

/** Why a repo couldn't be listed or got onto the worker machine, as the API answers it. */
export const repoProblem = (c: Context, why: RepoProblem) => {
  switch (why.kind) {
    case "unreached":
      return apiError(c, {
        status: 400,
        error: `Courtyard's GitHub App doesn't reach ${why.repo}. Add it to the app's repositories on GitHub, then try again.`,
      });
    case "added":
      return apiError(c, {
        status: 409,
        error: `The ${why.workspace} workspace works on ${why.repo} already.`,
      });
    case "workspaces":
      return contextError(c, why.error);
    case "clone":
      return apiError(c, {
        status: 502,
        error: `${why.repo} couldn't be got onto this machine: ${why.reason}`,
      });
    case "taken":
      return apiError(c, {
        status: 409,
        error: `There's a repo called ${why.repo} on your account, or on this machine, already.`,
      });
    case "unstarted":
      return apiError(c, {
        status: 502,
        error: `${why.repo} was made on GitHub, but its first files couldn't be pushed: ${why.reason}. Pick it from the list to add it.`,
      });
    default:
      return gitHubProblem(c, why);
  }
};

/** New workspace → Code's list of the owner's repos (#258). */
export const repoRoutes = (repos: Repos) => {
  const routes = new Hono();

  routes.get("/github/repos", async (c) => {
    const listed = await repos.list();
    if (!listed.ok) return repoProblem(c, listed.error);
    return c.json({ repos: listed.value } satisfies GitHubRepoList);
  });

  return routes;
};
