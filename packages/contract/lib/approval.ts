import { z } from "zod";

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
 * Answering an approval, by its event number, and what the worker answers: the answer that stands,
 * which is the first one given, from whichever device gave it.
 */
export const ApprovalAnswering = z.object({ answer: ApprovalAnswer });
export type ApprovalAnswering = z.infer<typeof ApprovalAnswering>;
