import type { Activity, FailureReason } from "@courtyard/contract";
import { memo } from "react";
import { PillButton } from "@/components/pill-button";
import { Answer } from "./answer.tsx";
import type { Turn } from "./events.ts";

/** What a model did, in a few words. */
const describeActivity = (activity: Activity) => {
  switch (activity.kind) {
    case "read-file":
      return `Read ${activity.path}`;
  }
};

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
 * One turn: the owner's message and the answer. Memoised, and the turns before the last never
 * change identity, so streaming text only re-renders the turn it belongs to.
 */
export const TurnView = memo(function TurnView(props: {
  turn: Turn;
  onRetry?: (turn: Turn) => void;
}) {
  const { turn, onRetry } = props;

  return (
    <div className="space-y-4">
      <p className="ml-auto w-fit max-w-[85%] rounded-[14px] rounded-br-sm bg-accent px-4 py-2.5 text-[15px]/[23px] whitespace-pre-wrap wrap-anywhere text-accent-foreground md:text-base/[25px]">
        {turn.text}
      </p>
      {turn.activities.length > 0 && (
        <ul
          aria-label="What the model did"
          className="space-y-0.5 text-[13px] wrap-anywhere text-muted-foreground"
        >
          {turn.activities.map((activity, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: activities only ever grow, in order
            <li key={index}>{describeActivity(activity)}</li>
          ))}
        </ul>
      )}
      {(turn.answer !== "" || turn.state.kind === "running") && (
        <div aria-live="polite">
          <Answer text={turn.answer} />
          {turn.state.kind === "running" && (
            <span
              aria-hidden
              className="mt-1 inline-block h-5 w-2 animate-pulse rounded-xs bg-primary-text"
            />
          )}
        </div>
      )}
      {turn.state.kind === "stopped" && (
        <p className="border-l-2 pl-3 text-sm text-muted-foreground">You stopped this turn.</p>
      )}
      {turn.state.kind === "failed" && (
        <div
          role="alert"
          className="flex items-start justify-between gap-4 rounded-md bg-destructive-soft px-3.5 py-3 text-sm/[21px] text-destructive-text"
        >
          <div>
            <p className="font-semibold">This turn didn't finish</p>
            <p>{describeFailure(turn.state.reason)}</p>
          </div>
          {onRetry && (
            <PillButton
              type="button"
              variant="outline"
              onClick={() => onRetry(turn)}
              className="h-8 bg-field px-3.5 text-foreground"
            >
              Retry
            </PillButton>
          )}
        </div>
      )}
    </div>
  );
});
