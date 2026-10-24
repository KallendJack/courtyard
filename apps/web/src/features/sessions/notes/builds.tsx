import type { SessionId } from "@courtyard/contract";
import { Hammer } from "lucide-react";
import { FileSaveNote } from "@/components/chat/file-save-note";
import { undoBuildSave } from "../../fabrication/api.ts";
import type { BuildNote } from "../turns/events.ts";

const LABELS = { add: "Started Build", change: "Updated Build" } as const;

/**
 * The Builds the model started or changed, as notes under its answer (#697): "Started Build" or
 * "Updated Build", its name, and in grey each parameter changed ("height: 900 mm → 850 mm"), with
 * Undo. Nothing when it saved none. They follow the session, so an Undo from any device shows here.
 */
export function BuildNotes(props: { sessionId: SessionId; notes: readonly BuildNote[] }) {
  const { sessionId, notes } = props;
  if (notes.length === 0) return null;
  return (
    <ul aria-label="Builds saved" className="space-y-1.5">
      {notes.map((note) => (
        <FileSaveNote
          key={note.seq}
          icon={<Hammer />}
          label={LABELS[note.save.action]}
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
