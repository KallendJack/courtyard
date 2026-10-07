import { type TidyId, TidyProposal, type TidyRequest, type TidySave } from "@courtyard/contract";
import { z } from "zod";
import { type ContextPlace, sendJson } from "../worker.ts";

// Tidy's calls live with Tidy rather than in worker.ts, so its schemas stay off the first load.

/** Asks for a tidy of a workspace's context file or the owner context. It can take a minute. */
export const proposeTidy = (about: ContextPlace, request: TidyRequest) =>
  sendJson({
    path:
      about.kind === "owner"
        ? "/owner-context/tidy"
        : `/workspaces/${encodeURIComponent(about.id)}/tidy`,
    body: request,
    schema: TidyProposal,
  });

/** Saves the changes of a proposed tidy that the owner left ticked. */
export const saveTidy = (id: TidyId, save: TidySave) =>
  sendJson({ path: `/tidies/${id}/save`, body: save, schema: z.unknown() });
