import { DOCUMENT_MAX_CHARACTERS, type DocumentList, WorkspaceId } from "@courtyard/contract";
import { type Context, Hono } from "hono";
import { apiError, contextError } from "../http.ts";
import {
  type DocumentRefusal,
  type DocumentTarget,
  type DocumentUndoRefusal,
  listDocuments,
} from "./index.ts";

/** Why a document wasn't saved, renamed, deleted or undone, as the API answers it. */
export const documentError = (c: Context, refusal: DocumentRefusal | DocumentUndoRefusal) => {
  switch (refusal.kind) {
    case "workspace":
      return contextError(c, refusal.error);
    case "code-workspace":
      return apiError(c, { status: 409, error: "Only planning workspaces keep documents." });
    case "no-name":
      return apiError(c, {
        status: 400,
        error: "Give the document a name with at least one letter or number.",
      });
    case "too-long":
      return apiError(c, {
        status: 409,
        error: `That's over ${DOCUMENT_MAX_CHARACTERS.toLocaleString("en-GB")} characters, too long for one document.`,
      });
    case "clash":
      return apiError(c, {
        status: 409,
        error: `There's already a document called ${refusal.name}. Choose another name.`,
      });
    case "not-found":
      return apiError(c, { status: 404, error: "No such document." });
    case "unread":
    case "stale":
    case "changed-since":
      return apiError(c, {
        status: 409,
        error: "That document has changed since, so this would lose the newer text.",
      });
    case "not-undoable":
      return apiError(c, { status: 409, error: "This change can't be undone from here." });
    case "already-undone":
      return apiError(c, { status: 409, error: "This change is already undone." });
    case "storage":
      return apiError(c, {
        status: 500,
        error: "The workspace's documents can't be read or written.",
      });
  }
};

/** A workspace's documents, under `/api`. */
export const documentRoutes = (target: Pick<DocumentTarget, "contextDir" | "contextFolder">) => {
  const routes = new Hono();

  /** The target for the workspace a path names, or `undefined` when it can't name one. */
  const inWorkspace = (c: Context) => {
    const id = WorkspaceId.safeParse(c.req.param("id"));
    return id.success ? { ...target, workspaceId: id.data } : undefined;
  };

  routes.get("/workspaces/:id/documents", async (c) => {
    const workspace = inWorkspace(c);
    if (workspace === undefined) return contextError(c, { kind: "not-found" });
    const documents = await listDocuments(workspace);
    if (!documents.ok) return documentError(c, documents.error);
    return c.json({ documents: documents.value } satisfies DocumentList);
  });

  return routes;
};
