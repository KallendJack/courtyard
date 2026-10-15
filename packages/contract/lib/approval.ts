import { z } from "zod";
import { SessionId } from "./session.ts";

// Approvals (#171, ADR 0007): what a code session asks the owner before it runs a command off the
// command allowlist, changes a file outside its worktree or takes an action of a tool connection
// that isn't safe (ADR 0008), and the owner's answer.

/** What a model wants to do that needs the owner's approval, exactly as it would happen. */
export const ApprovalAsk = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("command"),
    /** The command, exactly as it would run. */
    command: z.string(),
    /** Why it needs an approval: it isn't on the allowlist, or it names a path outside the worktree. */
    reason: z.enum(["off-allowlist", "reaches-out"]),
  }),
  /** A change to a file outside the session branch's worktree, by its full path. */
  z.object({ kind: z.literal("edit"), path: z.string() }),
  /**
   * A change, inside the worktree, to a file that decides what its allowed commands run: a
   * `package.json`, git hooks, Claude Code's `.claude` folder, git's own `.git`. By its path from
   * the worktree.
   */
  z.object({ kind: z.literal("setup"), path: z.string() }),
  /**
   * An action of a tool connection that isn't safe (ADR 0008): by the connection's name, the
   * action's, and its input as the model sent it, in JSON. For now only Paper's deleting something
   * the session didn't make (ADR 0023).
   */
  z.object({
    kind: z.literal("tool"),
    connection: z.string(),
    action: z.string(),
    input: z.string(),
    reason: z.enum(["deletes-unmade"]),
  }),
]);
export type ApprovalAsk = z.infer<typeof ApprovalAsk>;

/** The owner's answer to an approval: Allow or Deny. */
export const ApprovalAnswer = z.enum(["allow", "deny"]);
export type ApprovalAnswer = z.infer<typeof ApprovalAnswer>;

/**
 * What Allow always (#185) would let a code session run from then on without asking: a command by
 * its leading words, as Claude Code does, so the same command with other arguments doesn't ask
 * again (`more`), or, for a command that's one word, that word alone. The worker works it out and
 * offers it on the approval, so the card shows exactly what it would allow before the tap.
 */
export const AlwaysAllow = z.object({
  words: z.array(z.string().regex(/^\S+$/)).min(1),
  more: z.boolean(),
});
export type AlwaysAllow = z.infer<typeof AlwaysAllow>;

/** How long Allow always keeps a command allowed: until the session ends, or in the workspace. */
export const AlwaysFor = z.enum(["session", "workspace"]);
export type AlwaysFor = z.infer<typeof AlwaysFor>;

/**
 * Answering an approval, by its event number, and what the worker answers: the answer that stands,
 * which is the first one given, from whichever device gave it. Allow can also allow the command
 * always (#185), for the session or the workspace, when the approval offered it.
 */
export const ApprovalAnswering = z
  .object({ answer: ApprovalAnswer, always: AlwaysFor.optional() })
  .refine((answering) => answering.always === undefined || answering.answer === "allow", {
    message: "only Allow allows always",
    path: ["always"],
  });
export type ApprovalAnswering = z.infer<typeof ApprovalAnswering>;

/**
 * A command the owner allowed always in a code workspace (#185), as its Allowed commands list
 * shows it: what it allows, when, and from which session, by its title then.
 */
export const AllowedCommand = z.object({
  allows: AlwaysAllow,
  at: z.iso.datetime(),
  from: z.object({ session: SessionId, title: z.string() }).optional(),
});
export type AllowedCommand = z.infer<typeof AllowedCommand>;

/** A code workspace's Allowed commands (#185): what the owner allowed always, newest first. */
export const AllowedCommands = z.object({ commands: z.array(AllowedCommand) });
export type AllowedCommands = z.infer<typeof AllowedCommands>;

/** Removing one of a code workspace's Allowed commands (#185), by what it allows. */
export const AllowedCommandRemoval = z.object({ allows: AlwaysAllow });
export type AllowedCommandRemoval = z.infer<typeof AllowedCommandRemoval>;
