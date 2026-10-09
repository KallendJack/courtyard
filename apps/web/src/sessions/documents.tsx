import { DOCUMENT_NAME_MAX_LENGTH, type SessionId, type WorkspaceId } from "@courtyard/contract";
import { FileCheck, FilePlus, Undo2 } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Button } from "@/components/button";
import { ButtonLink } from "@/components/button-link";
import { NoteRow, NoteWords } from "@/components/note-row";
import { TextField } from "@/components/text-field";
import { useAction } from "@/lib/use-action";
import { saveAsDocument, undoDocumentSave } from "../documents/api.ts";
import { describeProblem } from "../problems.tsx";
import type { DocumentNote } from "./events.ts";

/** Where a session's documents go: its planning workspace, and the session's own title. */
export type DocumentsHere = {
  readonly workspaceId: WorkspaceId;
  readonly workspaceName: string;
  readonly sessionTitle: string;
};

/** The name Save as document starts from: the answer's first heading, or the session's title. */
const nameFrom = (answer: string, sessionTitle: string) => {
  const heading = /^#{1,6}[ \t]+(.+?)[ \t#]*$/m.exec(answer)?.[1]?.replace(/[*_`]/g, "").trim();
  return (heading || sessionTitle).slice(0, DOCUMENT_NAME_MAX_LENGTH);
};

/**
 * Save as document beside Copy under a finished answer (ADR 0020): it opens a name field in place,
 * and saves the whole answer with no model turn. Its note shows once the session records it.
 */
export function SaveAsDocument(props: {
  sessionId: SessionId;
  /** The owner message's event number, which names the answer. */
  answer: number;
  text: string;
  here: DocumentsHere;
}) {
  const { sessionId, answer, here } = props;
  const [naming, setNaming] = useState(false);
  if (!naming) {
    return (
      <Button variant="quiet" size="xs" onClick={() => setNaming(true)}>
        <FilePlus className="size-[15px]" />
        Save as document
      </Button>
    );
  }
  return (
    <NameForm
      initial={nameFrom(props.text, here.sessionTitle)}
      workspaceName={here.workspaceName}
      save={async (name) => {
        const saved = await saveAsDocument(sessionId, { answer, name });
        return saved.kind === "loaded" ? undefined : describeProblem(saved).body;
      }}
      onDone={() => setNaming(false)}
    />
  );
}

/** The document's name, in place under the answer: Enter or Save keeps it, Escape or Cancel doesn't. */
function NameForm(props: {
  initial: string;
  workspaceName: string;
  save: (name: string) => Promise<string | undefined>;
  onDone: () => void;
}) {
  const [name, setName] = useState(props.initial);
  const save = useAction(props.save);
  const box = useRef<HTMLInputElement>(null);

  // Opened to name it, so the box takes the keyboard with the name selected.
  useEffect(() => {
    box.current?.focus();
    box.current?.select();
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (await save.run(name)) props.onDone();
  };

  return (
    <form
      onSubmit={submit}
      className="flex w-full flex-col gap-2.5 border-l-2 border-primary py-1 pl-3"
    >
      <TextField
        ref={box}
        label="Document name"
        error={save.error}
        value={name}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") props.onDone();
        }}
        maxLength={DOCUMENT_NAME_MAX_LENGTH}
        required
        autoComplete="off"
      />
      <div className="flex flex-wrap items-center gap-3">
        <p className="flex-1 text-xs text-muted-foreground">
          Saves the whole answer to {props.workspaceName}'s documents.
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={props.onDone}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={save.busy}>
            Save
          </Button>
        </div>
      </div>
    </form>
  );
}

/**
 * A document saved from an answer, as a note under it (ADR 0020): "Saved document" or "Updated
 * document", its name, what changed, with Open and Undo. It follows the session, so an Undo from
 * any device shows here too.
 */
export function DocumentNoteRow(props: {
  sessionId: SessionId;
  workspaceId: WorkspaceId;
  note: DocumentNote;
}) {
  const { sessionId, workspaceId, note } = props;
  const undo = useAction(async () => {
    const undone = await undoDocumentSave(sessionId, note.seq);
    return undone.kind === "loaded" ? undefined : describeProblem(undone).body;
  });
  const { action, document, summary } = note.save;
  return (
    <NoteRow
      icon={note.undone ? <Undo2 /> : <FileCheck />}
      muted={note.undone}
      actions={
        note.undone ? undefined : (
          <>
            <ButtonLink
              variant="quiet"
              size="xs"
              to="/workspaces/$workspaceId/documents/$slug"
              params={{ workspaceId, slug: document.slug }}
            >
              Open
            </ButtonLink>
            <Button variant="quiet" size="xs" onClick={() => void undo.run()} disabled={undo.busy}>
              Undo
            </Button>
          </>
        )
      }
      error={undo.error}
    >
      <NoteWords
        label={note.undone ? "Undone" : action === "save" ? "Saved document" : "Updated document"}
        line={document.name}
        aside={summary}
        muted={note.undone}
      />
    </NoteRow>
  );
}
