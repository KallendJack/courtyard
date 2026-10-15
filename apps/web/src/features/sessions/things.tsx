import type { SessionId, WorkspaceId } from "@courtyard/contract";
import { Tag } from "lucide-react";
import { FileSaveNote } from "@/components/file-save-note";
import { undoThingSave } from "../things/api.ts";
import { thingSaveWords } from "../things/words.ts";
import type { ThingNote } from "./events.ts";

const LABELS = { add: "Added Thing", change: "Updated Thing", remove: "Removed Thing" } as const;

/**
 * A Thing the model saved, as a note under its answer (ADR 0020): "Added Thing", "Updated Thing"
 * or "Removed Thing", its name, and in grey what changed, with Open, which goes to its card, and
 * Undo. It follows the session, so an Undo from any device shows here too.
 */
export function ThingNoteRow(props: {
  sessionId: SessionId;
  /** The session's workspace, where the Thing's card is; none for a session that has none. */
  workspaceId: WorkspaceId | undefined;
  note: ThingNote;
}) {
  const { sessionId, workspaceId, note } = props;
  const { action, thing } = note.save;
  return (
    <FileSaveNote
      icon={<Tag />}
      label={LABELS[action]}
      name={thing.name}
      aside={thingSaveWords(note.save)}
      open={
        action === "remove" || workspaceId === undefined
          ? undefined
          : {
              to: "/workspaces/$workspaceId/things/$slug",
              params: { workspaceId, slug: thing.slug },
            }
      }
      undone={note.undone}
      struck={action === "remove"}
      undo={() => undoThingSave(sessionId, note.seq)}
    />
  );
}
