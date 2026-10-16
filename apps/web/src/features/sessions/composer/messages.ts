import {
  type AllowAllLasts,
  type AllowAllRequest,
  type AlwaysFor,
  type ApprovalAnswer,
  ApprovalAnswering,
  ATTACHMENTS_FIELD,
  type AttachmentId,
  type FirstMessage,
  MESSAGE_FIELD,
  type NewMessage,
  type SessionId,
  SessionSummary,
  type WorkspaceId,
} from "@courtyard/contract";
import { z } from "zod";
import { sendForm } from "../../../api/send-form.ts";
import { type FromWorker, sendJson } from "../../../api/worker.ts";
import { sendPatiently, type Waiting } from "../../../lib/patience.ts";

// Sending the owner's messages, with any photos and PDFs attached (#78). Beside `worker.ts` rather
// than in it, since only the pages with a message box send them: none of it is on the first load.

/**
 * Sends a message to the worker's API, with any files attached: JSON on its own, or a multipart
 * form with the message's JSON in one field and the files in another.
 */
const sendMessageWithFiles = async <T>(request: {
  path: string;
  message: NewMessage | FirstMessage;
  files: readonly File[];
  schema: z.ZodType<T>;
}): Promise<FromWorker<T>> => {
  const { path, message, files, schema } = request;
  if (files.length === 0) return sendJson({ path, body: message, schema });
  const form = new FormData();
  form.set(MESSAGE_FIELD, JSON.stringify(message));
  for (const file of files) form.append(ATTACHMENTS_FIELD, file);
  return sendForm({ path, form, schema });
};

/**
 * Starts a session in a workspace with the owner's first message and any files attached; with no
 * model named, on the one the worker picks.
 */
export const startSession = (start: {
  workspaceId: WorkspaceId;
  message: FirstMessage;
  files: readonly File[];
}) =>
  sendMessageWithFiles({
    path: `/workspaces/${encodeURIComponent(start.workspaceId)}/sessions`,
    message: start.message,
    files: start.files,
    schema: SessionSummary,
  });

/** Sends the next message in a session, with any files attached. */
export const sendMessage = (send: {
  sessionId: SessionId;
  message: NewMessage;
  files?: readonly File[];
}) =>
  sendMessageWithFiles({
    path: `/sessions/${encodeURIComponent(send.sessionId)}/messages`,
    message: send.message,
    files: send.files ?? [],
    schema: z.unknown(),
  });

/**
 * Allow or Deny on the approval numbered `approval`, which a code session's turn waits on (#171),
 * or Allow always, for the session or the workspace (#185). The worker answers with the answer
 * that stands: the first given, from whichever device. So it's harmless to send twice, and the
 * owner's tap is kept until the worker answers (#204).
 */
export const answerApproval = (answering: {
  sessionId: SessionId;
  approval: number;
  answer: ApprovalAnswer;
  always?: AlwaysFor | undefined;
  onWaiting: (waiting: Waiting) => void;
  signal: AbortSignal;
}) =>
  sendPatiently({
    path: `/sessions/${encodeURIComponent(answering.sessionId)}/approvals/${answering.approval}`,
    body: {
      answer: answering.answer,
      ...(answering.always === undefined ? {} : { always: answering.always }),
    } satisfies ApprovalAnswering,
    schema: ApprovalAnswering,
    onWaiting: answering.onWaiting,
    signal: answering.signal,
  });

/** Removes the owner's queued message numbered `queued` before it goes (#177). */
export const removeQueued = (remove: { sessionId: SessionId; queued: number }) =>
  sendJson({
    path: `/sessions/${encodeURIComponent(remove.sessionId)}/queued/${remove.queued}`,
    method: "DELETE",
    body: {},
    schema: z.unknown(),
  });

/** Where one of a session's attachments is served from: for a thumbnail, or a PDF in a new tab. */
export const attachmentUrl = (sessionId: SessionId, id: AttachmentId) =>
  `/api/sessions/${encodeURIComponent(sessionId)}/attachments/${encodeURIComponent(id)}`;

/** Turns on Allow all for this task for a code session (#428), for as long as the owner picked. */
export const allowAll = (sessionId: SessionId, lasts: AllowAllLasts) =>
  sendJson({
    path: `/sessions/${encodeURIComponent(sessionId)}/allow-all`,
    body: { lasts } satisfies AllowAllRequest,
    schema: SessionSummary,
  });

/** Turns Allow all for this task off (#428), at once. */
export const allowAllOff = (sessionId: SessionId) =>
  sendJson({
    path: `/sessions/${encodeURIComponent(sessionId)}/allow-all/off`,
    body: {},
    schema: SessionSummary,
  });
