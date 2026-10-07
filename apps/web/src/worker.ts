import {
  ApiError,
  type ChangeId,
  ContextBackup,
  type GetToKnowRequest,
  LiveStatus,
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
const sendJson = async <T>(request: {
  path: string;
  method?: "POST" | "PATCH" | "DELETE";
  body: unknown;
  schema: z.ZodType<T>;
  unauthorised?: "logged-out" | "failed";
}): Promise<FromWorker<T>> => {
  try {
    const response = await fetch(`/api${request.path}`, {
      method: request.method ?? "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request.body),
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

/** Setup and login: a 401 here means a wrong password, so it carries the worker's message. */
export const sendPassword = (path: "/setup" | "/login", form: PasswordForm) =>
  sendJson({ path, body: form, schema: z.unknown(), unauthorised: "failed" });

export const logOut = () => sendJson({ path: "/logout", body: {}, schema: z.unknown() });
export const logOutOthers = () =>
  sendJson({ path: "/logout-others", body: {}, schema: z.unknown() });

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

/** Starts a session in a workspace with the owner's first message. */
export const startSession = (workspaceId: WorkspaceId, message: NewMessage) =>
  sendJson({
    path: `/workspaces/${encodeURIComponent(workspaceId)}/sessions`,
    body: message,
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

/** Sends the next message in a session. */
export const sendMessage = (sessionId: SessionId, message: NewMessage) =>
  sendJson({
    path: `/sessions/${encodeURIComponent(sessionId)}/messages`,
    body: message,
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
