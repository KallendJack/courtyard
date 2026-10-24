import type { FailureReason, SessionEvent, WorktreeKeptWhy } from "@courtyard/contract";

// What a turn's notes say, in plain words.

/** A failure's reason in plain words. */
export const describeFailure = (reason: FailureReason) => {
  switch (reason.kind) {
    case "rate-limited":
      return reason.resetAt
        ? `You've hit this model's usage limit. It resets at ${new Date(reason.resetAt).toLocaleString()}.`
        : "You've hit this model's usage limit.";
    case "interrupted":
      return "Courtyard's worker stopped before this turn finished.";
    case "provider-unavailable":
    case "unknown":
      return reason.message;
  }
};

/**
 * What became of a code session's worktree after 3 quiet days with no pull request (#605):
 * cleared, with the `wip/` branch its work went to if GitHub lacked any, or kept, and why.
 */
export type WorktreeNote =
  | { readonly kind: "cleared"; readonly wip: string | undefined }
  | { readonly kind: "kept"; readonly why: WorktreeKeptWhy };

/** A worktree's event as its turn's note. */
export const worktreeNoteOf = (
  event: Extract<SessionEvent, { type: "worktree-cleared" | "worktree-kept" }>,
): WorktreeNote =>
  event.type === "worktree-cleared"
    ? { kind: "cleared", wip: event.wip }
    : { kind: "kept", why: event.why };

/** Why a quiet worktree was kept, in plain words. */
const keptBecause: Record<WorktreeKeptWhy, string> = {
  "other-branch": "it's on another branch than its own",
  "secret-files": "it has new files that look like secrets (.env, a key), which would go to GitHub",
  "helper-work": "a helper's work isn't on its branch yet",
};

/** A worktree's note in plain words, and that the next message brings a cleared one back. */
export const worktreeWords = (note: WorktreeNote) =>
  note.kind === "kept"
    ? `Its worktree is kept after 3 quiet days, as clearing it could lose work: ${keptBecause[note.why]}.`
    : `Its worktree was cleared after 3 quiet days with no pull request${
        note.wip === undefined ? "" : `, its work kept on ${note.wip}`
      }. Your next message checks its branch out again.`;
