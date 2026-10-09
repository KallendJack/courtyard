import type { ChangeId } from "@courtyard/contract";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/button";
import { NoteRow, NoteWords } from "@/components/note-row";
import { useAction } from "@/lib/use-action";
import { describeProblem } from "../problems.tsx";
import { undoChange } from "./api.ts";

/**
 * Something just deleted from its page (a document, a Thing), as a note where its list is, with
 * Undo, as Recent changes has (ADR 0020).
 */
export function JustDeleted(props: {
  name: string;
  /** The change that deleted it, which Undo names; none when git couldn't keep it. */
  change: ChangeId | undefined;
  /** Once it's undone: the page loads its list again. */
  onUndone: () => Promise<void>;
}) {
  const { change } = props;
  const undo = useAction(async () => {
    if (change === undefined) return "This delete can't be undone from here.";
    const undone = await undoChange(change);
    if (undone.kind !== "loaded") return describeProblem(undone).body;
    await props.onUndone();
    return undefined;
  });
  return (
    <ul aria-label="Just deleted" className="mt-3">
      <NoteRow
        icon={<Trash2 />}
        actions={
          change === undefined ? undefined : (
            <Button variant="quiet" size="xs" onClick={() => void undo.run()} disabled={undo.busy}>
              Undo
            </Button>
          )
        }
        error={undo.error}
      >
        <NoteWords label="Deleted" line={props.name} />
      </NoteRow>
    </ul>
  );
}
