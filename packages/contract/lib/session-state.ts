import { z } from "zod";
import { ApprovalAsk } from "./approval.ts";
import { SessionSummary } from "./session.ts";
import { Activity } from "./session-event.ts";

// Whose turn it is in a session (#179), as its workspace's lists show it. Apart from `session.ts`,
// whose summaries the first load needs, so only the pages that list sessions load these.

/** What a running turn's model is doing now: its latest activity, writing its answer, or neither yet. */
export const Doing = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("thinking") }),
  z.object({ kind: z.literal("writing") }),
  z.object({ kind: z.literal("activity"), activity: Activity }),
]);
export type Doing = z.infer<typeof Doing>;

/**
 * Whose turn it is: the model's, working since the owner's message on what it's doing now; the
 * owner's, because the turn waits on their approval (#171), since it asked; or the owner's, with
 * no turn running.
 */
export const TurnNow = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("working"), since: z.iso.datetime(), doing: Doing }),
  z.object({ kind: z.literal("needs-you"), since: z.iso.datetime(), ask: ApprovalAsk }),
  z.object({ kind: z.literal("your-turn") }),
]);
export type TurnNow = z.infer<typeof TurnNow>;

/** A session as a workspace's lists show it: its summary, and whose turn it is. */
export const ListedSession = SessionSummary.extend({ now: TurnNow });
export type ListedSession = z.infer<typeof ListedSession>;

export const SessionList = z.object({ sessions: z.array(ListedSession) });
export type SessionList = z.infer<typeof SessionList>;
