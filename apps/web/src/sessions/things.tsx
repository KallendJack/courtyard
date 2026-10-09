import type { SessionId } from "@courtyard/contract";
import { Tag, Undo2 } from "lucide-react";
import { Button } from "@/components/button";
import { NoteRow, NoteWords } from "@/components/note-row";
import { useAction } from "@/lib/use-action";
import { describeProblem } from "../problems.tsx";
import { undoThingSave } from "../things/api.ts";
import { thingSaveWords } from "../things/words.ts";
import type { ThingNote } from "./events.ts";

const LABELS = { add: "Added Thing", change: "Updated Thing", remove: "Removed Thing" } as const;

/**
 * A Thing the model saved, as a note under its answer (ADR 0020): "Added Thing", "Updated Thing"
 * or "Removed Thing", its name, and in grey what changed, with Undo. It follows the session, so an
 * Undo from any device shows here too.
 */
export function ThingNoteRow(props: { sessionId: SessionId; note: ThingNote }) {
  const { sessionId, note } = props;
  const undo = useAction(async () => {
    const undone = await undoThingSave(sessionId, note.seq);
    return undone.kind === "loaded" ? undefined : describeProblem(undone).body;
  });
  const { action, thing } = note.save;
  return (
    <NoteRow
      icon={note.undone ? <Undo2 /> : <Tag />}
      muted={note.undone}
      actions={
        note.undone ? undefined : (
          <Button variant="quiet" size="xs" onClick={() => void undo.run()} disabled={undo.busy}>
            Undo
          </Button>
        )
      }
      error={undo.error}
    >
      <NoteWords
        label={note.undone ? "Undone" : LABELS[action]}
        line={thing.name}
        aside={thingSaveWords(note.save)}
        muted={note.undone}
        struck={action === "remove"}
      />
    </NoteRow>
  );
}
