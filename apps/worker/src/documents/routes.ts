import {
  DOCUMENT_MAX_CHARACTERS,
  type DocumentChanged,
  type DocumentDetail,
  type DocumentList,
  DocumentRename,
  type DocumentRenamed,
  DocumentSlug,
} from "@courtyard/contract";
import { type Context, Hono } from "hono";
import { apiError, contextError, readBody } from "../http.ts";
import type { PlanningFilesTarget } from "../planning-files/index.ts";
import { DOCUMENTS, fileIn, sharedFileError, workspaceIn } from "../planning-files/routes.ts";
import {
  type DocumentRefusal,
  type DocumentUndoRefusal,
  deleteDocument,
  getDocument,
  listDocuments,
  renameDocument,
} from "./index.ts";

/** Why a document wasn't saved, renamed, deleted or undone, as the API answers it. */
export const documentError = (c: Context, refusal: DocumentRefusal | DocumentUndoRefusal) => {
  switch (refusal.kind) {
    case "workspace":
    case "code-workspace":
    case "not-found":
    case "not-undoable":
    case "already-undone":
    case "storage":
      return sharedFileError(c, refusal, DOCUMENTS);
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
    case "unread":
    case "stale":
    case "changed-since":
      return apiError(c, {
        status: 409,
        error: "That document has changed since, so this would lose the newer text.",
      });
  }
};

/** A workspace's documents, under `/api`. */
export const documentRoutes = (
  target: Pick<PlanningFilesTarget, "contextDir" | "contextFolder">,
) => {
  const routes = new Hono();

  const inWorkspace = (c: Context) => workspaceIn(c, target);

  routes.get("/workspaces/:id/documents", async (c) => {
    const workspace = inWorkspace(c);
    if (workspace === undefined) return contextError(c, { kind: "not-found" });
    const documents = await listDocuments(workspace);
    if (!documents.ok) return documentError(c, documents.error);
    return c.json({ documents: documents.value } satisfies DocumentList);
  });

  const documentIn = (c: Context) => fileIn(c, target, DocumentSlug);
  const noSuchDocument = (c: Context) => sharedFileError(c, { kind: "not-found" }, DOCUMENTS);

  routes.get("/workspaces/:id/documents/:slug", async (c) => {
    const named = documentIn(c);
    if (named === undefined) return noSuchDocument(c);
    const found = await getDocument(named.workspace, named.slug);
    if (!found.ok) return documentError(c, found.error);
    return c.json(found.value satisfies DocumentDetail);
  });

  routes.patch("/workspaces/:id/documents/:slug", async (c) => {
    const named = documentIn(c);
    if (named === undefined) return noSuchDocument(c);
    const body = await readBody(c, DocumentRename);
    if (!body.ok) return apiError(c, { status: 400, error: body.error });
    const renamed = await renameDocument(named.workspace, {
      slug: named.slug,
      name: body.value.name,
    });
    if (!renamed.ok) return documentError(c, renamed.error);
    const now = await getDocument(named.workspace, renamed.value.save.document.slug);
    if (!now.ok) return documentError(c, now.error);
    return c.json({
      change: renamed.value.change ?? null,
      document: now.value.document,
    } satisfies DocumentRenamed);
  });

  routes.delete("/workspaces/:id/documents/:slug", async (c) => {
    const named = documentIn(c);
    if (named === undefined) return noSuchDocument(c);
    const deleted = await deleteDocument(named.workspace, named.slug);
    if (!deleted.ok) return documentError(c, deleted.error);
    return c.json({ change: deleted.value ?? null } satisfies DocumentChanged);
  });

  return routes;
};
