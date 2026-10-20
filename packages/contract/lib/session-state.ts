import { z } from "zod";
import { ApprovalAsk } from "./approval.ts";
import { SessionId, SessionSummary } from "./session.ts";
import { Activity } from "./session-event.ts";
import { WorkspaceId } from "./workspace.ts";

// Whose turn it is in a session (#179), as its workspace's lists show it. Apart from `session.ts`,
// whose summaries the first load needs, so only the pages that list sessions load these.

/**
 * What a running turn's model is doing now: its latest activity, writing its answer, or neither
 * yet; or, in a code session, nothing yet, as the turn waits for a place among the code sessions
 * running (#362), with how many turns wait ahead of it (none known before #362).
 */
export const Doing = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("thinking") }),
  z.object({ kind: z.literal("writing") }),
  z.object({ kind: z.literal("activity"), activity: Activity }),
  z.object({
    kind: z.literal("waiting-for-place"),
    ahead: z.number().int().nonnegative().optional(),
  }),
]);
export type Doing = z.infer<typeof Doing>;

/**
 * Whose turn it is: the model's, working since the owner's message on what it's doing now; the
 * owner's, because the turn waits on their approval (#171), since it asked; or the owner's, with
 * no turn running.
 */
export const TurnNow = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("working"), since: z.iso.datetime(), doing: Doing }),
  z.object({
    kind: z.literal("needs-you"),
    since: z.iso.datetime(),
    ask: ApprovalAsk,
    /** The approval's event number, which answers it from a list (#301's Needs you). */
    approval: z.number().int().positive(),
  }),
  z.object({ kind: z.literal("your-turn") }),
]);
export type TurnNow = z.infer<typeof TurnNow>;

/**
 * What a session waits on the owner for (#334; AGENTS.md), decided once, by the worker, so every
 * screen and device agrees: the approval its turn asked for; its last turn, cut off by a restart in
 * the last day, for Continue (#186); a question it asked the owner (#541); a builder's last turn
 * failed (not at a usage limit), for Continue, or a builder stopped with no pull request and no
 * question (#541), each until the owner answers, however long and whatever they've read; a Lead's
 * builder stalled, silent for `BUILDER_STALLS_AFTER_MINUTES` with nothing waiting on the owner or
 * CI (#474), until it carries on; a new reply, an answer from the last day that the owner hasn't
 * seen; or nothing.
 */
export const SessionWaiting = z.enum([
  "approval",
  "cut-off",
  "asked",
  "turn-failed",
  "stopped",
  "stalled",
  "reply",
  "nothing",
]);
export type SessionWaiting = z.infer<typeof SessionWaiting>;

/**
 * A question a code session asked the owner (#541): in a line, the choices it offers (the one it
 * would pick first; none when it needs the owner's words), and its event number, which answers it.
 */
export const OwnerQuestion = z.object({
  text: z.string(),
  choices: z.array(z.string()),
  asked: z.number().int().positive(),
});
export type OwnerQuestion = z.infer<typeof OwnerQuestion>;

/**
 * Answering a session's question with one of its choices (#541), from a list: the question by its
 * event number, so a tap that arrives once it's answered sends nothing, and the choice by its place.
 */
export const QuestionAnswer = z.object({
  asked: z.number().int().positive(),
  choice: z.number().int().nonnegative(),
});
export type QuestionAnswer = z.infer<typeof QuestionAnswer>;

/**
 * How long a Lead's builder may be silent (no turn, commit or event) before it's stalled (#474):
 * time waiting on the owner or on CI doesn't count.
 */
export const BUILDER_STALLS_AFTER_MINUTES = 20;

/**
 * A session as a workspace's lists show it: its summary, whose turn it is, and what it waits on
 * the owner for: while that's its question (#541), the question; and while it waits until answered
 * (asked, failed or stopped), `seen` once the owner has read it, which never clears it.
 */
export const ListedSession = SessionSummary.extend({
  now: TurnNow,
  waiting: SessionWaiting,
  question: OwnerQuestion.optional(),
  seen: z.literal(true).optional(),
});
export type ListedSession = z.infer<typeof ListedSession>;

export const SessionList = z.object({ sessions: z.array(ListedSession) });
export type SessionList = z.infer<typeof SessionList>;

/**
 * One thing waiting on the owner (#492), in any workspace: a session's approval, its turn cut off
 * by a restart, its question (#541), its builder's turn failed or stopped with no pull request
 * (#541), its builder stalled (#474), or its new reply; or its pull request's failing checks,
 * merge or conflict. Each names its workspace and session, so a row or the Next pill opens it in
 * one tap; one that waits until answered says whether the owner has `seen` it.
 */
export const NeedYou = z.discriminatedUnion("kind", [
  z.object({
    kind: z.enum(["approval", "cut-off", "turn-failed", "stopped", "stalled", "reply"]),
    workspace: z.object({ id: WorkspaceId, name: z.string() }),
    session: z.object({ id: SessionId, title: z.string() }),
    since: z.iso.datetime(),
    seen: z.literal(true).optional(),
  }),
  z.object({
    kind: z.literal("asked"),
    workspace: z.object({ id: WorkspaceId, name: z.string() }),
    session: z.object({ id: SessionId, title: z.string() }),
    since: z.iso.datetime(),
    question: OwnerQuestion,
    seen: z.literal(true).optional(),
  }),
  z.object({
    kind: z.enum(["failed", "merge", "conflict"]),
    workspace: z.object({ id: WorkspaceId, name: z.string() }),
    session: z.object({ id: SessionId, title: z.string() }),
    since: z.iso.datetime(),
    pullRequest: z.object({ number: z.number().int().positive(), title: z.string().optional() }),
  }),
]);
export type NeedYou = z.infer<typeof NeedYou>;

/**
 * Everything waiting on the owner, in every workspace (#492), in Needs you's order (#301):
 * stalled builders (#474), approvals, turns cut off, failing checks, new replies, merges, then
 * conflicts, the newest first in each. `busy` while a turn runs anywhere, so whatever shows it asks again sooner.
 */
export const NeedsYou = z.object({ needs: z.array(NeedYou), busy: z.boolean() });
export type NeedsYou = z.infer<typeof NeedsYou>;

/**
 * The owner has seen a session up to its event numbered `upTo` (#334): its page showed them
 * everything to there, on whichever device, so an answer up to it is no longer a new reply.
 */
export const SessionSeen = z.object({ upTo: z.number().int().positive() });
export type SessionSeen = z.infer<typeof SessionSeen>;
