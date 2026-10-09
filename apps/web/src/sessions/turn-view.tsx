import {
  type Activity,
  type FailureReason,
  type ProviderList,
  type SessionId,
  skillTitle,
  type WorkspaceId,
} from "@courtyard/contract";
import { ArrowRightLeft } from "lucide-react";
import { memo, useState } from "react";
import { PdfChip, PhotoThumb } from "@/components/attachment";
import { Button } from "@/components/button";
import { CopyButton } from "@/components/copy-button";
import { Notice } from "@/components/notice";
import { PhotoViewer } from "@/components/photo-viewer";
import { SkillTag } from "@/components/skill-tag";
import { SuggestedReplies } from "@/components/suggested-replies";
import { Answer } from "./answer.tsx";
import { DocumentNoteRow, type DocumentsHere, SaveAsDocument } from "./documents.tsx";
import type { Turn } from "./events.ts";
import { LimitNotice } from "./limit-notice.tsx";
import { attachmentUrl } from "./messages.ts";
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
}) {
  const { sessionId, turn, providers, onRetry, onCarryOn, onReply, workspaceId, documents } = props;

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
      <OwnerMessage sessionId={sessionId} turn={turn} />
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
