import type { Activity, FailureReason, SessionId } from "@courtyard/contract";
import { memo } from "react";
import { Button } from "@/components/button";
import { Notice } from "@/components/notice";
import { Answer } from "./answer.tsx";
import type { Turn } from "./events.ts";
import { SaveNote } from "./save-note.tsx";

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
 * One turn: the owner's message, the answer, and a note for each save it made. Memoised, and a
 * turn's object only changes when an event belongs to it, so streaming text (or an Undo) only
 * re-renders that turn.
 */
export const TurnView = memo(function TurnView(props: {
  sessionId: SessionId;
  turn: Turn;
  onRetry?: (turn: Turn) => void;
}) {
  const { sessionId, turn, onRetry } = props;

  return (
    <div className="space-y-4">
      <p className="ml-auto w-fit max-w-[85%] rounded-bubble rounded-br-sm bg-accent px-4 py-2.5 text-[15px]/[23px] whitespace-pre-wrap wrap-anywhere text-accent-foreground md:text-base/[25px]">
        {turn.text}
      </p>
      {turn.activities.length > 0 && (
        <ul
          aria-label="What the model did"
          className="space-y-0.5 text-xs wrap-anywhere text-muted-foreground"
        >
          {turn.activities.map((activity, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: activities only ever grow, in order
            <li key={index}>{describeActivity(activity)}</li>
          ))}
        </ul>
      )}
      {(turn.answer !== "" || turn.state.kind === "running") && (
        // Busy while it streams, so a screen reader reads the answer once, when it's whole.
        <div aria-live="polite" aria-busy={turn.state.kind === "running"}>
          <Answer text={turn.answer} />
          {turn.state.kind === "running" && (
            <span
              aria-hidden
              className="mt-1 inline-block h-5 w-2 animate-pulse rounded-xs bg-primary-text"
            />
          )}
        </div>
      )}
      {turn.notes.length > 0 && (
        <ul aria-label="Saved to context" className="space-y-1.5">
          {turn.notes.map((note) => (
            <SaveNote key={note.seq} sessionId={sessionId} note={note} />
          ))}
        </ul>
      )}
      {turn.state.kind === "stopped" && (
        <p className="border-l-2 pl-3 text-sm text-muted-foreground">You stopped this turn.</p>
      )}
      {turn.state.kind === "failed" && (
        <Notice
          title="This turn didn't finish"
          {...(onRetry
            ? {
                action: (
                  <Button variant="outline" size="sm" onClick={() => onRetry(turn)}>
                    Retry
                  </Button>
                ),
              }
            : {})}
        >
          {describeFailure(turn.state.reason)}
        </Notice>
      )}
    </div>
  );
});
