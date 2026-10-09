import {
  ApiError,
  ATTACHMENTS_FIELD,
  type AttachmentId,
  type CarryOnRequest,
  type ChangeId,
  ContextBackup,
  type GetToKnowRequest,
  LiveStatus,
  MESSAGE_FIELD,
  type NewMessage,
  type NewWorkspace,
  OwnerContextDetail,
  type PasswordForm,
  ProviderList,
  RecentChanges,
  type SaveEdit,
  type SessionChange,
  type SessionId,
  SessionSummary,
  SkillList,
  type StopRequest,
  type WorkspaceChange,
  type WorkspaceId,
  WorkspaceSummary,
} from "@courtyard/contract";
import { z } from "zod";

/** What came back from the worker: the data, or why there isn't any. */
export type FromWorker<T> =
  | { readonly kind: "loaded"; readonly data: T }
  | { readonly kind: "not-found" }
  | { readonly kind: "logged-out" }
  | { readonly kind: "failed"; readonly status: number; readonly message: string }
  | { readonly kind: "offline" };

/** What a page loads for a path that can't name anything, such as a workspace id that can't be one. */
export const NOT_FOUND = { kind: "not-found" } as const;

/**
 * Turns a response into one of the kinds above, parsing its body with the contract's schema. A 401
 * means the device isn't logged in, except from the password forms, where it means a wrong password.
 */
const readResponse = async <T>(read: {
  response: Response;
  schema: z.ZodType<T>;
  unauthorised: "logged-out" | "failed";
}): Promise<FromWorker<T>> => {
  const { response, schema, unauthorised } = read;
  const body: unknown = await response.json().catch(() => null);
  if (response.ok) {
    const parsed = schema.safeParse(body);
    return parsed.success ? { kind: "loaded", data: parsed.data } : { kind: "offline" };
  }
  if (response.status === 404) return { kind: "not-found" };
  const error = ApiError.safeParse(body);
  if (!error.success) return { kind: "offline" };
  return response.status === 401 && unauthorised === "logged-out"
    ? { kind: "logged-out" }
    : { kind: "failed", status: response.status, message: error.data.error };
};

/**
 * Asks the worker's API and parses the answer with the contract's schema. A worker that can't be
 * reached, or answers with something unexpected, counts as offline; a worker that answers with an
 * error says what went wrong.
 */
export const fromWorker = async <T>(path: string, schema: z.ZodType<T>): Promise<FromWorker<T>> => {
  try {
    const response = await fetch(`/api${path}`);
    return await readResponse({ response, schema, unauthorised: "logged-out" });
  } catch {
    return { kind: "offline" };
  }
};

/** Sends JSON to the worker's API (a POST unless `method` says) and reads the answer with `schema`. */
export const sendJson = async <T>(request: {
  path: string;
  method?: "POST" | "PATCH" | "DELETE";
  body: unknown;
  schema: z.ZodType<T>;
  unauthorised?: "logged-out" | "failed";
  /** Stops the request, and whatever the worker is doing for it, when the page no longer wants it. */
  signal?: AbortSignal;
}): Promise<FromWorker<T>> => {
  try {
    const response = await fetch(`/api${request.path}`, {
      method: request.method ?? "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request.body),
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    });
    return await readResponse({
      response,
      schema: request.schema,
      unauthorised: request.unauthorised ?? "logged-out",
    });
  } catch {
    return { kind: "offline" };
  }
};

/**
 * Sends a message to the worker's API, with any files attached (#78): JSON on its own, or a
 * multipart form with the message's JSON in one field and the files in another.
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

/** Where one of a session's attachments is served from: for a thumbnail, or a PDF in a new tab. */
export const attachmentUrl = (sessionId: SessionId, id: AttachmentId) =>
  `/api/sessions/${encodeURIComponent(sessionId)}/attachments/${encodeURIComponent(id)}`;

/** Setup and login: a 401 here means a wrong password, so it carries the worker's message. */
export const sendPassword = (path: "/setup" | "/login", form: PasswordForm) =>
  sendJson({ path, body: form, schema: z.unknown(), unauthorised: "failed" });

export const logOut = () => sendJson({ path: "/logout", body: {}, schema: z.unknown() });
export const logOutOthers = () =>
  sendJson({ path: "/logout-others", body: {}, schema: z.unknown() });

/** A workspace's skills, for the skill picker and its Skills section (ADR 0016). */
export const loadSkills = (workspaceId: WorkspaceId): Promise<FromWorker<SkillList>> =>
  fromWorker(`/workspaces/${encodeURIComponent(workspaceId)}/skills`, SkillList);

/** The providers and their models, for the model picker. */
export const loadProviders = () => fromWorker("/providers", ProviderList);

/** Adds a workspace: its folder, a starter context file and a colour. */
export const addWorkspace = (workspace: NewWorkspace) =>
  sendJson({ path: "/workspaces", body: workspace, schema: WorkspaceSummary });

/** Whether the context folder's backup has every change. */
export const loadBackup = () => fromWorker("/backup", ContextBackup);

/** Whether this worker can update itself from the app, and what's newer. */
export const loadLive = () => fromWorker("/live", LiveStatus);

/** Starts updating the live copy; the worker restarts partway through. */
export const startLiveUpdate = () =>
  sendJson({ path: "/live/update", body: {}, schema: z.unknown() });

/** The owner context, or `null` when there isn't one yet. */
export const loadOwnerContext = () => fromWorker("/owner-context", OwnerContextDetail);

/** Starts the owner context from the worker's starter file. */
export const startOwnerContext = () =>
  sendJson({ path: "/owner-context", body: {}, schema: OwnerContextDetail });

/** Renames a workspace or changes its colour. Its folder stays as it is. */
export const changeWorkspace = (id: WorkspaceId, change: WorkspaceChange) =>
  sendJson({
    path: `/workspaces/${encodeURIComponent(id)}`,
    method: "PATCH",
    body: change,
    schema: WorkspaceSummary,
  });

/** Archives a workspace: it leaves every list, and its folder moves to the archived folder. */
export const archiveWorkspace = (id: WorkspaceId) =>
  sendJson({
    path: `/workspaces/${encodeURIComponent(id)}/archive`,
    body: {},
    schema: z.unknown(),
  });

/** Renames a session. */
export const renameSession = (id: SessionId, change: SessionChange) =>
  sendJson({
    path: `/sessions/${encodeURIComponent(id)}`,
    method: "PATCH",
    body: change,
    schema: SessionSummary,
  });

/** Deletes a session and its event log. */
export const deleteSession = (id: SessionId) =>
  sendJson({
    path: `/sessions/${encodeURIComponent(id)}`,
    method: "DELETE",
    body: {},
    schema: z.unknown(),
  });

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

/** A page of a workspace's or the owner context's Recent changes, after the change `after`. */
export const loadChanges = (about: ContextPlace, after?: ChangeId) => {
  const place =
    about.kind === "owner" ? "/owner-context" : `/workspaces/${encodeURIComponent(about.id)}`;
  return fromWorker(
    `${place}/changes${after === undefined ? "" : `?after=${after}`}`,
    RecentChanges,
  );
};

/** Undoes a change from Recent changes. */
export const undoChange = (id: ChangeId) =>
  sendJson({ path: `/changes/${id}/undo`, body: {}, schema: z.unknown() });

/** A context file to act on: one workspace's, or the owner context. */
export type ContextPlace =
  | { readonly kind: "workspace"; readonly id: WorkspaceId }
  | { readonly kind: "owner" };

/** Starts a session getting to know a workspace or the owner context, with the worker's starter. */
export const startGettingToKnow = (about: ContextPlace, start: GetToKnowRequest) =>
  sendJson({
    path:
      about.kind === "owner"
        ? "/owner-context/get-to-know"
        : `/workspaces/${encodeURIComponent(about.id)}/get-to-know`,
    body: start,
    schema: SessionSummary,
  });

/** Stops a session's running turn, named by its owner message's event number. */
export const stopTurn = (sessionId: SessionId, turn: number) =>
  sendJson({
    path: `/sessions/${encodeURIComponent(sessionId)}/stop`,
    body: { turn } satisfies StopRequest,
    schema: z.unknown(),
  });

/** Carry on: the turn that hit a usage limit goes again to another provider (spec, Overflow). */
export const carryOn = (sessionId: SessionId, turn: number) =>
  sendJson({
    path: `/sessions/${encodeURIComponent(sessionId)}/carry-on`,
    body: { turn } satisfies CarryOnRequest,
    schema: z.unknown(),
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

/** Undoes one of a session's saves, named by its event number. */
export const undoSave = ({ sessionId, save }: { sessionId: SessionId; save: number }) =>
  sendJson({
    path: `/sessions/${encodeURIComponent(sessionId)}/saves/${save}/undo`,
    body: {},
    schema: z.unknown(),
  });

/** Edits one of a session's saved lines: its wording, its section, or both. */
export const editSave = (change: { sessionId: SessionId; save: number; edit: SaveEdit }) =>
  sendJson({
    path: `/sessions/${encodeURIComponent(change.sessionId)}/saves/${change.save}/edit`,
    body: change.edit,
    schema: z.unknown(),
  });
