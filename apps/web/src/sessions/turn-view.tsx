import {
  type Activity,
  type FailureReason,
  type ProviderList,
  type SessionId,
  skillTitle,
} from "@courtyard/contract";
import { ArrowRightLeft } from "lucide-react";
import { memo } from "react";
import { Button } from "@/components/button";
import { Notice } from "@/components/notice";
import { SkillTag } from "@/components/skill-tag";
import { SuggestedReplies } from "@/components/suggested-replies";
import { Answer } from "./answer.tsx";
import type { Turn } from "./events.ts";
import { LimitNotice } from "./limit-notice.tsx";
import { answeringWith, availableModels } from "./models.ts";
import { SaveNote } from "./save-note.tsx";
import { SourceList, siteOf } from "./sources.tsx";

/** What a model did, in a few words. */
const describeActivity = (activity: Activity) => {
  switch (activity.kind) {
    case "read-file":
      return `Read ${activity.path}`;
    case "skill-loaded":
      return `Used ${skillTitle(activity.name)}`;
    case "skill-file-read":
      return `Read ${skillTitle(activity.name)}'s ${activity.path}`;
    case "web-searched":
      return `Searched the web for “${activity.query}”`;
    case "page-read":
      return `Read ${siteOf(activity.url)}`;
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
 * One turn: the owner's message, the answer, and a note for each save it made, with a quiet line
 * above it when it went to another model than the turn before. Memoised, and a turn's object only
 * changes when an event belongs to it, so streaming text (or an Undo) only re-renders that turn.
 */
export const TurnView = memo(function TurnView(props: {
  sessionId: SessionId;
  turn: Turn;
  /** The providers on offer, which name the models and say where a session can carry on. */
  providers: ProviderList["providers"];
  onRetry?: (turn: Turn) => void;
  onCarryOn?: (turn: Turn) => Promise<string | undefined>;
  /** Sends a suggested reply to this turn (the latest only): whether it was sent. */
  onReply?: (turn: Turn, reply: string) => Promise<boolean>;
}) {
  const { sessionId, turn, providers, onRetry, onCarryOn, onReply } = props;

  return (
    <div className="space-y-4">
      {turn.modelChanged && (
        <p className="flex items-center gap-3 text-xs text-muted-foreground before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border">
          <ArrowRightLeft aria-hidden className="size-3.5 shrink-0" />
          <span className="max-w-[70%]">
            Now answering:{" "}
            {answeringWith({
              models: availableModels(providers),
              ref: turn.model,
              effort: turn.effort,
            })}
          </span>
        </p>
      )}
      <div className="ml-auto flex w-fit max-w-[85%] flex-col gap-1.5 rounded-bubble rounded-br-sm bg-accent px-4 py-2.5 text-accent-foreground">
        {turn.skill !== undefined && <SkillTag name={turn.skill} look="message" />}
        <p className="text-[15px]/[23px] whitespace-pre-wrap wrap-anywhere md:text-base/[25px]">
          {turn.text}
        </p>
      </div>
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
          <Answer
            text={turn.answer}
            running={turn.state.kind === "running"}
            replayed={turn.replayed}
          />
          {turn.state.kind === "running" && (
            <span
              aria-hidden
              className="mt-1 inline-block h-5 w-2 animate-pulse rounded-xs bg-primary-text"
            />
          )}
        </div>
      )}
      {turn.sources.length > 0 && <SourceList sources={turn.sources} />}
      {turn.notes.length > 0 && (
        <ul aria-label="Saved to context" className="space-y-1.5">
          {turn.notes.map((note) => (
            <SaveNote key={note.seq} sessionId={sessionId} note={note} />
          ))}
        </ul>
      )}
      {onReply && turn.state.kind === "done" && turn.replies.length > 0 && (
        <SuggestedReplies replies={turn.replies} onPick={(reply) => onReply(turn, reply)} />
      )}
      {turn.state.kind === "stopped" && (
        <p className="border-l-2 pl-3 text-sm text-muted-foreground">You stopped this turn.</p>
      )}
      {turn.state.kind === "failed" && turn.state.reason.kind === "rate-limited" && (
        <LimitNotice
          turn={turn}
          reason={turn.state.reason}
          providers={providers}
          {...(onCarryOn ? { onCarryOn } : {})}
        />
      )}
      {turn.state.kind === "failed" && turn.state.reason.kind !== "rate-limited" && (
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
