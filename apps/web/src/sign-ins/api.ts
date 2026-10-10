import { GitHubConnection, type ProviderId, ProviderSignIn, SignInList } from "@courtyard/contract";
import { z } from "zod";
import { fromWorker, sendJson } from "../worker.ts";

// Signing in's calls live with it rather than in worker.ts, so its schemas stay off the first load.

/** Each provider Courtyard signs in to, and where its sign-in stands (ADR 0015). */
export const loadSignIns = () => fromWorker("/sign-ins", SignInList);

/** Starts signing in to a provider: its sign-in, now waiting, with the link and code. */
export const startSignIn = (provider: ProviderId) =>
  sendJson({
    path: `/sign-ins/${encodeURIComponent(provider)}/start`,
    body: {},
    schema: ProviderSignIn,
  });

/** Acts on a provider's sign-in: gives up the one in progress, signs out, or says Not now. */
export const changeSignIn = (provider: ProviderId, change: "cancel" | "sign-out" | "not-now") =>
  sendJson({
    path: `/sign-ins/${encodeURIComponent(provider)}/${change}`,
    body: {},
    schema: z.unknown(),
  });

/** Where Courtyard's own GitHub sign-in stands (#99). */
export const loadGitHub = () => fromWorker("/github", GitHubConnection);

/** Signs in to GitHub, or switches account: the sign-in, now waiting, with the link and code. */
export const startGitHubSignIn = () =>
  sendJson({ path: "/github/sign-in", body: {}, schema: GitHubConnection });

/** Gives up a GitHub sign-in in progress, or signs out. */
export const changeGitHub = (change: "cancel" | "sign-out") =>
  sendJson({ path: `/github/${change}`, body: {}, schema: z.unknown() });
