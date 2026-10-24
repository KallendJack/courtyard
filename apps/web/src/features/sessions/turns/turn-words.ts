import type { FailureReason } from "@courtyard/contract";

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
 * That a code session's worktree was cleared after 3 quiet days with no pull request (#605), the
 * `wip/` branch its work went to, if any, and that the next message brings it back.
 */
export const clearedWords = (wip: string | undefined) =>
  `Its worktree was cleared after 3 quiet days with no pull request${
    wip === undefined ? "" : `, its work kept on ${wip}`
  }. Your next message checks its branch out again.`;
