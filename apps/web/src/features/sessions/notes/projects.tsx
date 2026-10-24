import type { SessionId, WorkspaceId } from "@courtyard/contract";
import { Route } from "lucide-react";
import { FileSaveNote } from "@/components/chat/file-save-note";
import { projectHash, undoProjectSave } from "../../projects/api.ts";
import type { ProjectNote } from "../turns/events.ts";

const LABELS = { add: "Started project", change: "Updated project" } as const;

/**
 * A project the model started or changed, as a note under its answer (#603): "Started project" or
 * "Updated project", its name, and in grey what changed ("Step: Sockets by the desk (needs a
 * pro)"), with Open, which goes to the project, and Undo. It follows the session, so an Undo from
 * any device shows here too.
 */
function ProjectNoteRow(props: {
  sessionId: SessionId;
  /** The session's workspace, where the project is; none for a session that has none. */
  workspaceId: WorkspaceId | undefined;
  note: ProjectNote;
}) {
  const { sessionId, workspaceId, note } = props;
  const { action, project, changes } = note.save;
  return (
    <FileSaveNote
      icon={<Route />}
      label={LABELS[action]}
      name={project.name}
      aside={changes.length === 0 ? undefined : changes.join("; ")}
      open={
        workspaceId === undefined
          ? undefined
          : {
              to: "/workspaces/$workspaceId",
              params: { workspaceId },
              hash: projectHash(project.slug),
            }
      }
      undone={note.undone}
      undo={() => undoProjectSave(sessionId, note.seq)}
    />
  );
}

/** The projects the model started or changed in an answer, as notes under it; nothing for none. */
export function ProjectNotes(props: {
  sessionId: SessionId;
  workspaceId: WorkspaceId | undefined;
  notes: readonly ProjectNote[];
}) {
  const { sessionId, workspaceId, notes } = props;
  if (notes.length === 0) return null;
  return (
    <ul aria-label="Projects saved" className="space-y-1.5">
      {notes.map((note) => (
        <ProjectNoteRow
          key={note.seq}
          sessionId={sessionId}
          workspaceId={workspaceId}
          note={note}
        />
      ))}
    </ul>
  );
}
