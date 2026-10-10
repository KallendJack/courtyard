import type { GitHubConnection } from "@courtyard/contract";
import { type Context, Hono } from "hono";
import { apiError } from "../http.ts";
import type { GitHub, GitHubProblem } from "./index.ts";

const STORAGE = "Courtyard couldn't read or keep its GitHub sign-in.";

const problem = (c: Context, why: GitHubProblem) => {
  switch (why.kind) {
    case "not-set-up":
      return apiError(c, {
        status: 404,
        error: "GitHub isn't set up on this worker: register Courtyard's GitHub App first.",
      });
    case "github":
      return apiError(c, { status: 502, error: why.message });
    case "storage":
      return apiError(c, { status: 500, error: STORAGE });
  }
};

/** Courtyard's GitHub sign-in, from Connections on the home page (#99). */
export const gitHubRoutes = (github: GitHub) => {
  const routes = new Hono();

  /** Where the sign-in stands, as the home page shows it. */
  const answer = async (c: Context) => {
    const status = await github.status();
    if (!status.ok) return apiError(c, { status: 500, error: STORAGE });
    return c.json(status.value satisfies GitHubConnection);
  };

  routes.get("/github", answer);
  /** Signs in, or switches account: answers with the device code to enter. */
  routes.post("/github/sign-in", async (c) => {
    const started = await github.start();
    return started.ok ? answer(c) : problem(c, started.error);
  });
  routes.post("/github/cancel", (c) => {
    github.cancel();
    return c.body(null, 204);
  });
  routes.post("/github/sign-out", async (c) => {
    const signedOut = await github.signOut();
    return signedOut.ok ? c.body(null, 204) : problem(c, signedOut.error);
  });

  return routes;
};
