import { z } from "zod";
import { SessionId } from "./session.ts";
import { WorkspaceId } from "./workspace.ts";

/** The words the owner types to confirm a fresh start. */
export const FRESH_START_WORDS = "start fresh";

/** A fresh start, confirmed with the exact words. */
export const FreshStartRequest = z.object({
  confirm: z.literal(FRESH_START_WORDS, { error: `Type “${FRESH_START_WORDS}” to confirm.` }),
});
export type FreshStartRequest = z.infer<typeof FreshStartRequest>;

/**
 * What a fresh start would clear now: how many workspaces (archived ones too), sessions and tidies
 * waiting for review; the session whose turn is running, which stops it; and the folder in the data
 * folder the sessions would move to.
 */
export const FreshStartSummary = z.object({
  workspaces: z.number().int().nonnegative(),
  sessions: z.number().int().nonnegative(),
  tidies: z.number().int().nonnegative(),
  running: z
    .object({
      id: SessionId,
      title: z.string(),
      workspaceId: WorkspaceId,
      workspaceName: z.string(),
    })
    .nullable(),
  folder: z.string(),
});
export type FreshStartSummary = z.infer<typeof FreshStartSummary>;
