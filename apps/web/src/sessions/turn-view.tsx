import {
  type Activity,
  CODE_SESSIONS_AT_ONCE,
  type FailureReason,
  type ProviderList,
  type SessionId,
  skillTitle,
  type WorkspaceId,
} from "@courtyard/contract";
import { ArrowRightLeft, X } from "lucide-react";
import { memo, type ReactNode, useState } from "react";
import { ApprovalCard, approvalWords } from "@/components/approval-card";
import { PdfChip, PhotoThumb } from "@/components/attachment";
import { Button } from "@/components/button";
import { CopyButton } from "@/components/copy-button";
import { Notice } from "@/components/notice";
import { PhotoViewer } from "@/components/photo-viewer";
import { type Queued, QueuedMessages } from "@/components/queued-message";
import { SkillTag } from "@/components/skill-tag";
import { SuggestedReplies } from "@/components/suggested-replies";
import { TurnEndMark, WorkingLine } from "@/components/working-line";
import { classes } from "@/lib/classes";
import { describeProblem } from "../problems.tsx";
import { Answer } from "./answer.tsx";
import { DocumentNoteRow, type DocumentsHere, SaveAsDocument } from "./documents.tsx";
import type { ShownImage, Turn } from "./events.ts";
import { LimitNotice } from "./limit-notice.tsx";
import { answerApproval, attachmentUrl } from "./messages.ts";
import { answeringWith, availableModels } from "./models.ts";
import { SaveNote } from "./save-note.tsx";
import { SourceList, sourcesAsMarkdown } from "./sources.tsx";
import { ThingNoteRow } from "./things.tsx";

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
      return `Read ${activity.site}`;
    case "edited-file":
      return `Edited ${activity.path}`;
    case "ran-command":
      return `Ran ${activity.command}`;
    case "check-failed":
      return `Check ${activity.name} failed`;
    case "used-tool":
      return `Used ${activity.connection}: ${activity.action}`;
  }
};

/**
 * The images a turn's tool connections showed (ADR 0023), such as screenshots of a Paper board:
 * thumbnails that open full size, as the owner's photos do.
 */
function ShownImages(props: { sessionId: SessionId; images: readonly ShownImage[] }) {
  const [viewing, setViewing] = useState<number>();
  const photos = props.images.map(({ image }) => ({
    src: attachmentUrl(props.sessionId, image.id),
    name: image.name,
  }));
  return (
    <div className="flex flex-wrap gap-1.5">
      {photos.map((photo, index) => (
        <PhotoThumb
          key={photo.src}
          in="message"
          src={photo.src}
          name={photo.name}
          onOpen={() => setViewing(index)}
        />
      ))}
      <PhotoViewer
        photos={photos}
        showing={viewing}
        show={setViewing}
        onClose={() => setViewing(undefined)}
      />
    </div>
  );
}

/** What a model did between two pieces of what it wrote, a line each. */
function Activities(props: { activities: readonly Activity[] }) {
  return (
    <ul
      aria-label="What the model did"
      className="space-y-0.5 text-xs wrap-anywhere text-muted-foreground"
    >
      {props.activities.map((activity, index) => (
        <li
          // biome-ignore lint/suspicious/noArrayIndexKey: activities only ever grow, in order
          key={index}
          className={classes(
            activity.kind === "check-failed" && "flex items-center gap-1 text-destructive-text",
          )}
        >
          {activity.kind === "check-failed" && <X aria-hidden className="size-3.5 shrink-0" />}
          {describeActivity(activity)}
        </li>
      ))}
    </ul>
  );
}

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

/** A line about where a turn stands, under the owner's message: waiting, or stopped. */
function TurnNote(props: { children: ReactNode }) {
  return <p className="border-l-2 pl-3 text-sm text-muted-foreground">{props.children}</p>;
}

/**
 * The owner's message in its bubble, with any photos it carried as thumbnails that open full size
 * and PDFs as chips that open in a new tab (#78).
 */
function OwnerMessage(props: { sessionId: SessionId; turn: Turn }) {
  const { sessionId, turn } = props;
  const [viewing, setViewing] = useState<number>();
  const photos = turn.attachments.flatMap((attachment) =>
    attachment.kind === "photo"
      ? [{ src: attachmentUrl(sessionId, attachment.id), name: attachment.name }]
      : [],
  );
  const pdfs = turn.attachments.filter((attachment) => attachment.kind === "pdf");
  const words = (
    <>
      {turn.skill !== undefined && <SkillTag name={turn.skill} look="message" />}
      <p className="text-[15px]/[23px] whitespace-pre-wrap wrap-anywhere md:text-base/[25px]">
        {turn.text}
      </p>
    </>
  );
  if (turn.attachments.length === 0) {
    return (
      <div className="ml-auto flex w-fit max-w-[85%] flex-col gap-1.5 rounded-bubble rounded-br-sm bg-accent px-4 py-2.5 text-accent-foreground">
        {words}
      </div>
    );
  }
  return (
    <div className="ml-auto flex w-fit max-w-[85%] flex-col gap-2 rounded-bubble rounded-br-sm bg-accent px-1.5 pt-1.5 pb-2.5 text-accent-foreground">
      {photos.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {photos.map((photo, index) => (
            <PhotoThumb
              key={photo.src}
              in="message"
              src={photo.src}
              name={photo.name}
              onOpen={() => setViewing(index)}
            />
          ))}
        </div>
      )}
      {pdfs.map((pdf) => (
        <PdfChip
          key={pdf.id}
          in="message"
          name={pdf.name}
          size={pdf.size}
          href={attachmentUrl(sessionId, pdf.id)}
        />
      ))}
      <div className="flex flex-col gap-1.5 px-2.5">{words}</div>
      <PhotoViewer
        photos={photos}
        showing={viewing}
        show={setViewing}
        onClose={() => setViewing(undefined)}
      />
    </div>
  );
}

/**
 * What Copy answer copies: the answer's Markdown as the model wrote it, so it pastes formatted
 * anywhere that reads Markdown. Anything shown with the answer that belongs in a copy (its
 * Sources, say) is added here, as Markdown at the end.
 */
const answerToCopy = (turn: Turn) =>
  turn.sources.length === 0
    ? turn.answer.trim()
    : `${turn.answer.trim()}\n\n${sourcesAsMarkdown(turn.sources)}`;

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
  /** The session's workspace, where its documents' and Things' notes open. */
  workspaceId?: WorkspaceId;
  /** Where Save as document saves, in a planning workspace that isn't archived; none otherwise. */
  documents?: DocumentsHere;
  /** It's the session's latest turn, so its end is marked once it ends (#179). */
  latest?: boolean;
  /** The owner's messages waiting for it to end (#177), on the latest turn only, and removing one. */
  queued?: {
    readonly messages: readonly Queued[];
    readonly remove: (queued: number) => Promise<string | undefined>;
  };
}) {
  const { sessionId, turn, providers, onRetry, onCarryOn, onReply, workspaceId, documents } = props;
  const latest = props.latest === true;

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
      {/* A turn the worker started for a failed check opens with the check, in its activity. */}
      {!turn.fixesChecks && <OwnerMessage sessionId={sessionId} turn={turn} />}
      {/* What it wrote, each piece between the activities it's about (#200). */}
      {turn.parts.map((part, index) => {
        // Only the last piece can still be arriving.
        const running = turn.state.kind === "running" && index === turn.parts.length - 1;
        return part.kind === "activities" ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: parts only ever grow, in order
          <Activities key={index} activities={part.activities} />
        ) : (
          // Busy while it streams, so a screen reader reads each piece once, when it's whole.
          // biome-ignore lint/suspicious/noArrayIndexKey: parts only ever grow, in order
          <div key={index} aria-live="polite" aria-busy={running}>
            <Answer text={part.text} running={running} replayed={part.replayed} />
          </div>
        );
      })}
      {turn.queued && turn.state.kind === "running" && (
        <TurnNote>
          Waiting: {CODE_SESSIONS_AT_ONCE} code sessions are running already. This starts as soon as
          one of them ends.
        </TurnNote>
      )}
      {turn.images.length > 0 && <ShownImages sessionId={sessionId} images={turn.images} />}
      {/* While it runs, what it's doing now (#179); an approval it waits on says so itself. */}
      {turn.state.kind === "running" && !turn.queued && turn.approval === undefined && (
        <WorkingLine since={turn.startedAt} doing={turn.doing} />
      )}
      {turn.approval !== undefined && turn.state.kind === "running" && (
        <ApprovalCard
          {...approvalWords(turn.approval.ask, turn.approval.why)}
          onAnswer={async (answer) => {
            if (turn.approval === undefined) return undefined;
            const answered = await answerApproval({
              sessionId,
              approval: turn.approval.seq,
              answer,
            });
            return answered.kind === "loaded" ? undefined : describeProblem(answered).body;
          }}
        />
      )}
      {props.queued !== undefined && (
        <QueuedMessages
          messages={props.queued.messages}
          running={turn.state.kind === "running"}
          onRemove={props.queued.remove}
        />
      )}
      {turn.sources.length > 0 && <SourceList sources={turn.sources} />}
      {turn.answer !== "" && turn.state.kind !== "running" && (
        <div className="flex flex-wrap items-center gap-1">
          <CopyButton look="icon" label="Copy answer" text={() => answerToCopy(turn)} />
          {documents !== undefined && (
            <SaveAsDocument
              sessionId={sessionId}
              answer={turn.seq}
              text={turn.answer}
              here={documents}
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
      {turn.documents.length > 0 && workspaceId !== undefined && (
        <ul aria-label="Documents saved" className="space-y-1.5">
          {turn.documents.map((note) => (
            <DocumentNoteRow
              key={note.seq}
              sessionId={sessionId}
              workspaceId={workspaceId}
              note={note}
            />
          ))}
        </ul>
      )}
      {turn.things.length > 0 && (
        <ul aria-label="Things saved" className="space-y-1.5">
          {turn.things.map((note) => (
            <ThingNoteRow
              key={note.seq}
              sessionId={sessionId}
              workspaceId={workspaceId}
              note={note}
            />
          ))}
        </ul>
      )}
      {turn.state.kind === "stopped" && <TurnNote>You stopped this turn.</TurnNote>}
      {/* The latest turn's end, so a finished session never looks like one still working (#179). */}
      {latest && (turn.state.kind === "done" || turn.state.kind === "stopped") && (
        <TurnEndMark at={turn.state.at} stopped={turn.state.kind === "stopped"} />
      )}
      {onReply && turn.state.kind === "done" && turn.replies.length > 0 && (
        <SuggestedReplies replies={turn.replies} onPick={(reply) => onReply(turn, reply)} />
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
