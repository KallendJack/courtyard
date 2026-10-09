import {
  ATTACHMENTS_FIELD,
  type AttachmentId,
  MESSAGE_FIELD,
  type NewMessage,
  type SessionId,
  SessionSummary,
  type WorkspaceId,
} from "@courtyard/contract";
import { z } from "zod";
import { type FromWorker, readResponse, sendJson } from "../worker.ts";

// Sending the owner's messages, with any photos and PDFs attached (#78). Beside `worker.ts` rather
// than in it, since only the pages with a message box send them: none of it is on the first load.

/**
 * Sends a message to the worker's API, with any files attached: JSON on its own, or a multipart
 * form with the message's JSON in one field and the files in another.
 */
const sendMessageWithFiles = async <T>(request: {
  path: string;
  message: NewMessage;
  files: readonly File[];
  schema: z.ZodType<T>;
}): Promise<FromWorker<T>> => {
  const { path, message, files, schema } = request;
  if (files.length === 0) return sendJson({ path, body: message, schema });
  const form = new FormData();
  form.set(MESSAGE_FIELD, JSON.stringify(message));
  for (const file of files) form.append(ATTACHMENTS_FIELD, file);
  try {
    const response = await fetch(`/api${path}`, { method: "POST", body: form });
    return await readResponse({ response, schema, unauthorised: "logged-out" });
  } catch {
    return { kind: "offline" };
  }
};

/** Starts a session in a workspace with the owner's first message and any files attached. */
export const startSession = (
  workspaceId: WorkspaceId,
  message: NewMessage,
  files: readonly File[] = [],
) =>
  sendMessageWithFiles({
    path: `/workspaces/${encodeURIComponent(workspaceId)}/sessions`,
    message,
    files,
    schema: SessionSummary,
  });

/** Sends the next message in a session, with any files attached. */
export const sendMessage = (
  sessionId: SessionId,
  message: NewMessage,
  files: readonly File[] = [],
) =>
  sendMessageWithFiles({
    path: `/sessions/${encodeURIComponent(sessionId)}/messages`,
    message,
    files,
    schema: z.unknown(),
  });

/** Where one of a session's attachments is served from: for a thumbnail, or a PDF in a new tab. */
export const attachmentUrl = (sessionId: SessionId, id: AttachmentId) =>
  `/api/sessions/${encodeURIComponent(sessionId)}/attachments/${encodeURIComponent(id)}`;
