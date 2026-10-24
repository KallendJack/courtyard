import { err, type Result } from "../../lib/result.ts";
import { type HistoryChange, undoWholeFiles } from "../context-folder/index.ts";
import { undoDocumentChange } from "../documents/index.ts";
import { undoBuildChange } from "../fabrication/index.ts";
import { undoProjectChange } from "../projects/index.ts";
import { undoThingChange } from "../things/index.ts";
import type { ChangesTarget, ChangeUndoRefusal } from "./index.ts";

/**
 * Undoes a change to a document or a Thing (ADR 0020), a project (#603) or a Build (#697): through
 * its session when one made it, so the note there shows it as for a save, or else (the owner's own
 * change, or a session since deleted) file by file.
 */
export const undoWholeFileChange = async (
  target: ChangesTarget,
  change: HistoryChange,
): Promise<Result<null, ChangeUndoRefusal>> => {
  // A move (#603) is the owner's own, made by no session: its files go back as they were.
  if (change.kind === "move") {
    const undone = await undoWholeFiles(target, { id: change.id, kinds: ["move"] });
    if (undone.ok) return undone;
    switch (undone.error.kind) {
      case "not-found":
      case "storage":
        return err({ kind: undone.error.kind });
      case "changed-since":
        return err({ kind: "move-changed-since" });
      case "not-undoable":
      case "already-undone":
        return err({ kind: "not-undoable" });
    }
  }
  const of =
    change.kind === "thing" || change.kind === "project" || change.kind === "build"
      ? change.kind
      : "document";
  if (change.session !== undefined) {
    const { sessions } = target;
    const through = { rawId: change.session, save: change.id };
    const undone = await {
      thing: sessions.undoThing,
      project: sessions.undoProject,
      build: sessions.undoBuild,
      document: sessions.undoDocument,
    }[of](through);
    if (undone.ok) return undone;
    const gone = undone.error.kind === "not-found" || undone.error.kind === "save-not-found";
    if (!gone) return err({ kind: "session", error: undone.error });
  }
  const undone = await {
    thing: undoThingChange,
    project: undoProjectChange,
    build: undoBuildChange,
    document: undoDocumentChange,
  }[of](target, change.id);
  if (undone.ok) return undone;
  switch (undone.error.kind) {
    case "not-found":
    case "storage":
      return err({ kind: undone.error.kind });
    case "changed-since":
      return err({ kind: `${of}-changed-since` });
    case "not-undoable":
    case "already-undone":
      return err({ kind: "not-undoable" });
  }
};
