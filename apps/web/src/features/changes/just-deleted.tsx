import type { ChangeId } from "@courtyard/contract";
import { Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/buttons/button";
import { NoteRow, NoteWords } from "@/components/chat/note-row";
import { useAction } from "@/hooks/use-action";
import { describeProblem } from "../../components/layout/problems.tsx";
import { undoChange } from "./api.ts";

/**
 * Something just deleted from its page (a document, a Thing), as a note where its list is, with
 * Undo, as Recent changes has (ADR 0020); or just changed on its page, such as a part's upcoming
 * one fitted (#602), told by `did`.
 */
export function JustDeleted(props: {
  name: string;
  /** The change that deleted it, which Undo names; none when git couldn't keep it. */
  change: ChangeId | undefined;
  /** Once it's undone: the page loads its list again. */
  onUndone: () => Promise<void>;
  /** What was done, when it wasn't a delete: its note's label and icon ("Fitted"). */
  did?: { readonly label: string; readonly icon: ReactNode };
}) {
  const { change, did } = props;
  const undo = useAction(async () => {
    if (change === undefined)
      return `This ${did === undefined ? "delete" : "change"} can't be undone from here.`;
    const undone = await undoChange(change);
    if (undone.kind !== "loaded") return describeProblem(undone).body;
    await props.onUndone();
    return undefined;
  });
  return (
    <ul
      aria-label={did === undefined ? "Just deleted" : `Just ${did.label.toLowerCase()}`}
      className="mt-3"
    >
      <NoteRow
        icon={did?.icon ?? <Trash2 />}
        actions={
          change === undefined ? undefined : (
            <Button
              variant="quiet"
              size="xs"
              onClick={() => void undo.run()}
              busy={undo.busy}
              busyLabel="Undoing…"
            >
              Undo
            </Button>
          )
        }
        error={undo.error}
      >
        <NoteWords label={did?.label ?? "Deleted"} line={props.name} />
      </NoteRow>
    </ul>
  );
}
