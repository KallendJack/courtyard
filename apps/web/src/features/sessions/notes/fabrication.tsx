import type { SessionId } from "@courtyard/contract";
import { Hammer, Ruler } from "lucide-react";
import { FileSaveNote } from "@/components/chat/file-save-note";
import { undoBuildSave, undoSizeSave } from "../../fabrication/api.ts";
import type { BuildNote, SizeNote } from "../turns/events.ts";

/** The Builds and sizes the model saved in its answer, as notes under it (#697, #708). */
export function FabricationNotes(props: {
  sessionId: SessionId;
  builds: readonly BuildNote[];
  sizes: readonly SizeNote[];
}) {
  return (
    <>
      <BuildNotes sessionId={props.sessionId} notes={props.builds} />
      <SizeNotes sessionId={props.sessionId} notes={props.sizes} />
    </>
  );
}

const BUILD_LABELS = { add: "Started Build", change: "Updated Build" } as const;
const SIZE_LABELS = { add: "Recorded size", correct: "Corrected size" } as const;

/**
 * The Builds the model started or changed, as notes under its answer (#697): "Started Build" or
 * "Updated Build", its name, and in grey each parameter changed ("height: 900 mm → 850 mm"), with
 * Undo. Nothing when it saved none. They follow the session, so an Undo from any device shows here.
 */
function BuildNotes(props: { sessionId: SessionId; notes: readonly BuildNote[] }) {
  const { sessionId, notes } = props;
  if (notes.length === 0) return null;
  return (
    <ul aria-label="Builds saved" className="space-y-1.5">
      {notes.map((note) => (
        <FileSaveNote
          key={note.seq}
          icon={<Hammer />}
          label={BUILD_LABELS[note.save.action]}
          name={note.save.build.name}
          aside={note.save.changes.length === 0 ? undefined : note.save.changes.join("; ")}
          open={undefined}
          undone={note.undone}
          undo={() => undoBuildSave(sessionId, note.seq)}
        />
      ))}
    </ul>
  );
}

/**
 * The sizes the model recorded or corrected, as notes under its answer (#708): "Recorded size" or
 * "Corrected size", the Thing and what it's of, and in grey its value and where it came from
 * ("4260 mm · measured"), with Undo.
 */
function SizeNotes(props: { sessionId: SessionId; notes: readonly SizeNote[] }) {
  const { sessionId, notes } = props;
  if (notes.length === 0) return null;
  return (
    <ul aria-label="Sizes saved" className="space-y-1.5">
      {notes.map((note) => (
        <FileSaveNote
          key={note.seq}
          icon={<Ruler />}
          label={SIZE_LABELS[note.save.action]}
          name={`${note.save.size.thing}: ${note.save.size.property}`}
          aside={`${note.save.value} · ${note.save.source}`}
          open={undefined}
          undone={note.undone}
          undo={() => undoSizeSave(sessionId, note.seq)}
        />
      ))}
    </ul>
  );
}
