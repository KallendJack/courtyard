import { z } from "zod";
import { CodeSessionList } from "./code-sessions.ts";
import { SessionDetail } from "./session.ts";
import { SessionEvent } from "./session-event.ts";
import { OwnerContextDetail, WorkspaceDetail, WorkspaceList } from "./workspace.ts";

// Read offline (#106): what the worker gives a device that keeps a copy to read while it can't be
// reached. The web app stores it whole, read-only, and never sends it back.

/** How many of each workspace's sessions a copy keeps the conversation of: the latest, by last activity. */
export const OFFLINE_CONVERSATIONS = 5;

/**
 * A session's conversation as a copy keeps it: the owner's messages, the answers and the saves to
 * context, as the events that draw them. No tool activity, and no photos, only what they were.
 */
export const KeptConversation = z.object({
  session: SessionDetail,
  events: z.array(SessionEvent),
});
export type KeptConversation = z.infer<typeof KeptConversation>;

/**
 * One workspace as a copy keeps it: its page's detail (its context file), its sessions, calm (what
 * waits on the owner isn't kept), its latest sessions' conversations, and how many Things and
 * documents it has, which aren't kept, so its tabs still say so.
 */
export const KeptWorkspace = z.object({
  detail: WorkspaceDetail,
  sessions: CodeSessionList,
  conversations: z.array(KeptConversation),
  notKept: z.object({
    things: z.number().int().nonnegative(),
    documents: z.number().int().nonnegative(),
  }),
});
export type KeptWorkspace = z.infer<typeof KeptWorkspace>;

/** Everything a device keeps to read offline, as of `at`. */
export const OfflineCopy = z.object({
  at: z.iso.datetime(),
  ownerContext: OwnerContextDetail,
  workspaces: WorkspaceList,
  kept: z.array(KeptWorkspace),
});
export type OfflineCopy = z.infer<typeof OfflineCopy>;
