import {
  DocumentChanged,
  DocumentDetail,
  DocumentList,
  type DocumentRename,
  DocumentRenamed,
  DocumentSlug,
  type SaveAsDocument,
  type SessionId,
  WorkspaceId,
} from "@courtyard/contract";
import { z } from "zod";
import { fromWorker, NOT_FOUND, sendJson } from "../worker.ts";

// Documents' calls live with documents rather than in worker.ts, so their schemas stay off the
// first load.

const documentsOf = (workspaceId: WorkspaceId) =>
  `/workspaces/${encodeURIComponent(workspaceId)}/documents`;

/** A workspace's documents, the most recently changed first (ADR 0020). */
export const loadDocuments = (workspaceId: WorkspaceId) =>
  fromWorker(documentsOf(workspaceId), DocumentList);

/** One document for its page, by its address's workspace and file name. */
export const loadDocument = async (at: { workspaceId: string; slug: string }) => {
  const workspaceId = WorkspaceId.safeParse(at.workspaceId);
  const slug = DocumentSlug.safeParse(at.slug);
  if (!workspaceId.success || !slug.success) return NOT_FOUND;
  return fromWorker(`${documentsOf(workspaceId.data)}/${slug.data}`, DocumentDetail);
};

/** Renames a document: its heading and its file's name. */
export const renameDocument = (
  workspaceId: WorkspaceId,
  slug: DocumentSlug,
  rename: DocumentRename,
) =>
  sendJson({
    path: `${documentsOf(workspaceId)}/${slug}`,
    method: "PATCH",
    body: rename,
    schema: DocumentRenamed,
  });

/** Deletes a document, as a change Undo brings back. */
export const deleteDocument = (workspaceId: WorkspaceId, slug: DocumentSlug) =>
  sendJson({
    path: `${documentsOf(workspaceId)}/${slug}`,
    method: "DELETE",
    body: {},
    schema: DocumentChanged,
  });

/** Save as document: an answer, as a new document named by the owner. */
export const saveAsDocument = (sessionId: SessionId, save: SaveAsDocument) =>
  sendJson({
    path: `/sessions/${encodeURIComponent(sessionId)}/documents`,
    body: save,
    schema: DocumentChanged,
  });

/** Undoes one of a session's document saves, named by its event number. */
export const undoDocumentSave = (sessionId: SessionId, save: number) =>
  sendJson({
    path: `/sessions/${encodeURIComponent(sessionId)}/documents/${save}/undo`,
    body: {},
    schema: z.unknown(),
  });
