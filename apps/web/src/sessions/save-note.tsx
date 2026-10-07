import {
  CONTEXT_LINE_MAX_CHARACTERS,
  CONTEXT_SECTION_NAMES,
  ContextSection,
  type PlacedLine,
  placeName,
  type SaveEdit,
  type SessionId,
} from "@courtyard/contract";
import { BookmarkCheck, Undo2 } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Button } from "@/components/button";
import { FormError } from "@/components/form-error";
import { SegmentedChoice } from "@/components/segmented-choice";
import { TextField } from "@/components/text-field";
import { classes } from "@/lib/classes";
import { useAction } from "@/lib/use-action";
import { describeProblem } from "../problems.tsx";
import { editSave, undoSave } from "../worker.ts";
import type { Note } from "./events.ts";

const SECTIONS = ContextSection.options.map((value) => ({
  value,
  label: CONTEXT_SECTION_NAMES[value],
}));

/** Where an edited line can go: the workspace's context file, About me, or How to answer me. */
type Where = "workspace" | "aboutMe" | "answers";

const PLACES: readonly { readonly value: Where; readonly label: string }[] = [
  { value: "workspace", label: "Workspace" },
  { value: "aboutMe", label: "About me" },
  { value: "answers", label: "How to answer me" },
];

const whereOf = (line: PlacedLine): Where => {
  if (line.place === "workspace") return "workspace";
  return line.section === "answers" ? "answers" : "aboutMe";
};

/** The edit the form's choices make: How to answer me has no Facts, Plans or Ideas. */
const editOf = (choice: { where: Where; section: ContextSection; line: string }): SaveEdit => {
  const { where, section, line } = choice;
  if (where === "workspace") return { place: "workspace", section, line };
  return where === "aboutMe"
    ? { place: "owner", section, line }
    : { place: "owner", section: "answers", line };
};

/** What a note says: its label ("Saved to Facts"), its line, and what that line replaced. */
const wordsFor = (note: Note) => {
  const { save, state } = note;
  const edited = state.kind === "edited" ? " · edited" : "";
  switch (save.action) {
    case "add": {
      const line = state.kind === "edited" ? state.now : save.saved;
      return { label: `Saved to ${placeName(line)}${edited}`, line: line.line };
    }
    case "change": {
      const line = state.kind === "edited" ? state.now : save.saved;
      return {
        label: `Changed in ${placeName(line)}${edited}`,
        line: line.line,
        was: save.replaced.line,
      };
    }
    case "remove":
      return {
        label: `Removed from ${placeName(save.replaced)}`,
        line: save.replaced.line,
        struck: true,
      };
  }
};

/** The line a note's Edit starts from: the saved line as it is now. */
const currentLine = (note: Note): PlacedLine | undefined => {
  if (note.state.kind === "edited") return note.state.now;
  return note.save.action === "remove" ? undefined : note.save.saved;
};

/**
 * The line being edited where it is: its wording, its place (the workspace, About me or How to
 * answer me) and its section (ADR 0013).
 */
function EditForm(props: {
  line: PlacedLine;
  save: (edit: SaveEdit) => Promise<string | undefined>;
  onDone: () => void;
}) {
  const [line, setLine] = useState(props.line.line);
  const [where, setWhere] = useState(whereOf(props.line));
  const [section, setSection] = useState<ContextSection>(
    props.line.section === "answers" ? "facts" : props.line.section,
  );
  const save = useAction(props.save);
  const box = useRef<HTMLInputElement>(null);

  // Opened to change the wording, so the box takes the keyboard.
  useEffect(() => box.current?.focus(), []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const edit = editOf({ where, section, line });
    const unchanged =
      line.trim() === props.line.line &&
      edit.place === props.line.place &&
      edit.section === props.line.section;
    if (unchanged || (await save.run(edit))) props.onDone();
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-2.5">
      <TextField
        ref={box}
        label="Saved line"
        hideLabel
        error={save.error}
        value={line}
        onChange={(event) => setLine(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") props.onDone();
        }}
        maxLength={CONTEXT_LINE_MAX_CHARACTERS}
        required
        autoComplete="off"
      />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <SegmentedChoice label="Place" options={PLACES} value={where} onChange={setWhere} />
        {where !== "answers" && (
          <SegmentedChoice
            label="Section"
            options={SECTIONS}
            value={section}
            onChange={setSection}
          />
        )}
        <div className="ml-auto flex gap-2">
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
 * One save, as a note under the answer: what was saved where, with Undo and Edit (ADR 0013). It
 * follows the session, so an Undo or Edit from any device shows here too.
 */
export function SaveNote(props: { sessionId: SessionId; note: Note }) {
  const { sessionId, note } = props;
  const [editing, setEditing] = useState(false);
  const undo = useAction(async () => {
    const undone = await undoSave({ sessionId, save: note.seq });
    return undone.kind === "loaded" ? undefined : describeProblem(undone).body;
  });
  const undone = note.state.kind === "undone";
  const words = wordsFor(note);
  const line = currentLine(note);

  if (editing && line !== undefined && !undone) {
    return (
      <li className="border-l-2 border-primary py-1 pl-3">
        <EditForm
          line={line}
          save={async (now) => {
            const edited = await editSave({ sessionId, save: note.seq, edit: now });
            return edited.kind === "loaded" ? undefined : describeProblem(edited).body;
          }}
          onDone={() => setEditing(false)}
        />
      </li>
    );
  }

  return (
    <li
      className={classes(
        "grid grid-cols-[16px_1fr] items-start gap-x-3 border-l-2 py-0.5 pl-3 text-sm/[22px] md:grid-cols-[16px_1fr_auto] md:items-center",
        undone ? "border-border" : "border-primary",
      )}
    >
      {undone ? (
        <Undo2 aria-hidden className="mt-[3px] size-4 text-muted-foreground md:mt-0" />
      ) : (
        <BookmarkCheck aria-hidden className="mt-[3px] size-4 text-primary-text md:mt-0" />
      )}
      <p className="min-w-0 wrap-anywhere">
        <span
          className={classes(
            "font-semibold max-md:block md:mr-1.5",
            undone ? "text-muted-foreground" : "text-primary-text",
          )}
        >
          {undone ? "Undone" : words.label}
        </span>
        <span
          className={classes(
            undone || words.struck ? "text-muted-foreground line-through" : "text-foreground",
          )}
        >
          {words.line}
        </span>
        {words.was !== undefined && !undone && (
          <span className="text-muted-foreground"> (was {words.was})</span>
        )}
      </p>
      {!undone && (
        <div className="col-start-2 -ml-3 flex md:col-start-3 md:ml-0 md:w-[84px]">
          <Button variant="quiet" size="xs" onClick={() => void undo.run()} disabled={undo.busy}>
            Undo
          </Button>
          {line !== undefined && (
            <Button variant="quiet" size="xs" onClick={() => setEditing(true)}>
              Edit
            </Button>
          )}
        </div>
      )}
      {undo.error !== undefined && (
        <div className="col-start-2 md:col-end-4">
          <FormError message={undo.error} />
        </div>
      )}
    </li>
  );
}
