import { Undo2 } from "lucide-react";
import type { ReactNode } from "react";
import { useAction } from "@/lib/use-action";
import { describeProblem } from "../problems.tsx";
import type { FromWorker } from "../worker.ts";
import { Button } from "./button";
import { ButtonLink } from "./button-link";
import { NoteRow, NoteWords } from "./note-row";

/** The page a saved file opens on: a document's, or a Thing's card. */
type FilePage = {
  readonly to: "/workspaces/$workspaceId/documents/$slug" | "/workspaces/$workspaceId/things/$slug";
  readonly params: { readonly workspaceId: string; readonly slug: string };
};

/**
 * A document or a Thing a session saved, as a note under the answer (ADR 0020): what it did ("Saved
 * document", "Updated Thing"), the file's name, and in grey what changed, with Open and Undo. Once
 * undone it's grey, says so, and offers neither.
 */
export function FileSaveNote(props: {
  /** Beside the words until it's undone. */
  icon: ReactNode;
  label: string;
  name: string;
  /** What changed, in a few words. */
  aside: string | undefined;
  /** Its page, for Open; none once there's nothing to open (it was removed). */
  open: FilePage | undefined;
  undone: boolean;
  /** Struck through: the save removed it. */
  struck?: boolean;
  undo: () => Promise<FromWorker<unknown>>;
}) {
  const { open, undone } = props;
  const undo = useAction(async () => {
    const undoneNow = await props.undo();
    return undoneNow.kind === "loaded" ? undefined : describeProblem(undoneNow).body;
  });
  return (
    <NoteRow
      icon={undone ? <Undo2 /> : props.icon}
      muted={undone}
      actions={
        undone ? undefined : (
          <>
            {open !== undefined && (
              <ButtonLink variant="quiet" size="xs" to={open.to} params={open.params}>
                Open
              </ButtonLink>
            )}
            <Button variant="quiet" size="xs" onClick={() => void undo.run()} disabled={undo.busy}>
              Undo
            </Button>
          </>
        )
      }
      error={undo.error}
    >
      <NoteWords
        label={undone ? "Undone" : props.label}
        line={props.name}
        aside={props.aside}
        muted={undone}
        {...(props.struck === undefined ? {} : { struck: props.struck })}
      />
    </NoteRow>
  );
}
