import type { Activity, FailureReason } from "@courtyard/contract";
import { memo } from "react";
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
  /** Where it sits in the session, for the list that only draws turns near the screen. */
  index: number;
  offset: number;
  measure: (element: HTMLElement | null) => void;
}) {
  const { turn, onRetry } = props;

  return (
    <li
      ref={props.measure}
      data-index={props.index}
      className="absolute top-0 left-0 w-full space-y-3 pb-6"
      style={{ transform: `translateY(${props.offset}px)` }}
    >
      <p className="ml-auto max-w-[85%] whitespace-pre-wrap rounded-2xl bg-neutral-900 px-4 py-2 text-white">
        {turn.text}
      </p>
      {turn.activities.length > 0 && (
        <ul aria-label="What the model did" className="space-y-0.5 text-xs text-neutral-500">
          {turn.activities.map((activity, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: activities only ever grow, in order
            <li key={index}>{describeActivity(activity)}</li>
          ))}
        </ul>
      )}
      {(turn.answer !== "" || turn.state.kind === "running") && (
        <p className="max-w-[85%] whitespace-pre-wrap text-neutral-900" aria-live="polite">
          {turn.answer}
          {turn.state.kind === "running" && <span className="animate-pulse"> ▍</span>}
        </p>
      )}
      {turn.state.kind === "stopped" && (
        <p className="text-sm text-neutral-500">You stopped this turn.</p>
      )}
      {turn.state.kind === "failed" && (
        <div
          role="alert"
          className="max-w-[85%] rounded-md bg-red-50 px-3 py-2 text-sm text-red-900"
        >
          <p>{describeFailure(turn.state.reason)}</p>
          {onRetry && (
            <button
              type="button"
              onClick={() => onRetry(turn)}
              className="mt-1 font-medium underline"
            >
              Retry
            </button>
          )}
        </div>
      )}
    </li>
  );
});
