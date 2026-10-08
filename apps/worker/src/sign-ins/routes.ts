import type { ProviderSignIn, SignInList } from "@courtyard/contract";
import { type Context, Hono } from "hono";
import { apiError } from "../http.ts";
import type { Result } from "../result.ts";
import type { SignInProblem, SignIns } from "./index.ts";

const STORAGE = "Courtyard couldn't read or keep the owner's sign-in choices.";

const problem = (c: Context, why: SignInProblem) => {
  switch (why.kind) {
    case "no-sign-in":
      return apiError(c, { status: 404, error: "There's no sign-in for that provider." });
    case "provider":
      return apiError(c, { status: 502, error: why.message });
    case "storage":
      return apiError(c, { status: 500, error: STORAGE });
  }
};

/** Signing in to providers from the home page (ADR 0015). */
export const signInRoutes = (signIns: SignIns) => {
  const routes = new Hono();

  routes.get("/sign-ins", async (c) => {
    const listed = await signIns.list();
    if (!listed.ok) return apiError(c, { status: 500, error: STORAGE });
    return c.json({ signIns: listed.value } satisfies SignInList);
  });

  /** Answers with the sign-in as it stands after `done`, or why it couldn't be done. */
  const answer = (c: Context, done: Result<ProviderSignIn, SignInProblem>) =>
    done.ok ? c.json(done.value satisfies ProviderSignIn) : problem(c, done.error);
  const noContent = (c: Context, done: Result<unknown, SignInProblem>) =>
    done.ok ? c.body(null, 204) : problem(c, done.error);

  routes.post("/sign-ins/:provider/start", async (c) =>
    answer(c, await signIns.start(c.req.param("provider"))),
  );
  routes.post("/sign-ins/:provider/cancel", async (c) =>
    noContent(c, await signIns.cancel(c.req.param("provider"))),
  );
  routes.post("/sign-ins/:provider/sign-out", async (c) =>
    noContent(c, await signIns.signOut(c.req.param("provider"))),
  );
  routes.post("/sign-ins/:provider/not-now", async (c) =>
    noContent(c, await signIns.notNow(c.req.param("provider"))),
  );

  return routes;
};
