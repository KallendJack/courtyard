import {
  ApiError,
  type CarryOnRequest,
  type ContinueRequest,
  type NewWorkspace,
  type PasswordForm,
  type SaveEdit,
  type SessionId,
  type StopRequest,
  type WorkspaceChange,
  type WorkspaceId,
  WorkspaceList,
  type WorkspaceOrder,
  WorkspaceSummary,
} from "@courtyard/contract";
import { z } from "zod/mini";
import type { $ZodType } from "zod/v4/core";

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
export const readResponse = async <T>(read: {
  response: Response;
  schema: $ZodType<T>;
  unauthorised: "logged-out" | "failed";
}): Promise<FromWorker<T>> => {
  const { response, schema, unauthorised } = read;
  const body: unknown = await response.json().catch(() => null);
  if (response.ok) {
    const parsed = z.safeParse(schema, body);
    return parsed.success ? { kind: "loaded", data: parsed.data } : { kind: "offline" };
  }
  if (response.status === 404) return { kind: "not-found" };
  const error = ApiError.safeParse(body);
  if (!error.success) return { kind: "offline" };
  return response.status === 401 && unauthorised === "logged-out"
    ? { kind: "logged-out" }
    : { kind: "failed", status: response.status, message: error.data.error };
};

// Waiting on a worker that's slow to answer (#204, #228): a busy worker machine isn't a missing one.

/** How long a worker that gives no answer is tried again, quietly, before it counts as unreachable. */
const WAIT_FOR_WORKER_MS = 30_000;
/** A try that fails faster than this found nothing there: refused, or a dropped connection. */
const QUICK_FAILURE_MS = 1000;
/** How many quick failures in a row mean the connection is refused, rather than one dropped. */
const REFUSED_AFTER = 3;
const FIRST_RETRY_MS = 250;
const LONGEST_RETRY_MS = 4000;

/**
 * One try: the worker's own answer, or nothing when it gave none (unreachable, or a proxy
 * answering for it).
 */
export const tryOnce = async (send: () => Promise<Response>) => {
  try {
    const response = await send();
    if (response.status < 500) return response;
    // A worker's own error says what went wrong; any other is a proxy's, for no answer.
    const said: unknown = await response
      .clone()
      .json()
      .catch(() => null);
    return ApiError.safeParse(said).success ? response : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Tries `send` until the worker answers, or nothing once it counts as unreachable: a network
 * that's down, or a connection refused (quick failures, several in a row), can't be reached now;
 * anything else is a slow worker, tried again with longer waits each time, until
 * `WAIT_FOR_WORKER_MS` has gone. Gives up after the try `signal` stops.
 */
export const untilAnswered = async (send: () => Promise<Response>, signal?: AbortSignal) => {
  const first = Date.now();
  const failed: number[] = [];
  for (;;) {
    const started = Date.now();
    const response = await tryOnce(send);
    if (response || signal?.aborted) return response;
    failed.push(Date.now() - started);
    const lastFew = failed.slice(-REFUSED_AFTER);
    const refused =
      lastFew.length === REFUSED_AFTER && lastFew.every((tookMs) => tookMs < QUICK_FAILURE_MS);
    const left = WAIT_FOR_WORKER_MS - (Date.now() - first);
    if (!navigator.onLine || refused || left <= 0) return;
    const backoff = FIRST_RETRY_MS * 2 ** (failed.length - 1);
    await new Promise((wake) => setTimeout(wake, Math.min(backoff, LONGEST_RETRY_MS, left)));
  }
};

/**
 * Asks the worker's API and parses the answer with the contract's schema, waiting for a worker
 * that's slow to answer. A worker that can't be reached, or answers with something unexpected,
 * counts as offline; a worker that answers with an error says what went wrong.
 */
export const fromWorker = async <T>(path: string, schema: $ZodType<T>): Promise<FromWorker<T>> => {
  const response = await untilAnswered(() => fetch(`/api${path}`));
  return response
    ? readResponse({ response, schema, unauthorised: "logged-out" })
    : { kind: "offline" };
};

/** Sends JSON to the worker's API (a POST unless `method` says) and reads the answer with `schema`. */
export const sendJson = async <T>(request: {
  path: string;
  method?: "POST" | "PUT" | "PATCH" | "DELETE";
  body: unknown;
  schema: $ZodType<T>;
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

/** Setup and login: a 401 here means a wrong password, so it carries the worker's message. */
export const sendPassword = (path: "/setup" | "/login", form: PasswordForm) =>
  sendJson({ path, body: form, schema: z.unknown(), unauthorised: "failed" });

export const logOut = () => sendJson({ path: "/logout", body: {}, schema: z.unknown() });
export const logOutOthers = () =>
  sendJson({ path: "/logout-others", body: {}, schema: z.unknown() });

/** Adds a workspace: its folder, a starter context file and an icon suggested from its name. */
export const addWorkspace = (workspace: NewWorkspace) =>
  sendJson({ path: "/workspaces", body: workspace, schema: WorkspaceSummary });

/** Renames a workspace or changes its icon. Its folder stays as it is. */
export const changeWorkspace = (id: WorkspaceId, change: WorkspaceChange) =>
  sendJson({
    path: `/workspaces/${encodeURIComponent(id)}`,
    method: "PATCH",
    body: change,
    schema: WorkspaceSummary,
  });

/** Keeps the owner's order for the workspaces (#321) and answers with them in it. */
export const arrangeWorkspaces = (order: readonly WorkspaceId[]) =>
  sendJson({
    path: "/workspaces/order",
    method: "PUT",
    body: { order: [...order] } satisfies WorkspaceOrder,
    schema: WorkspaceList,
  });

/** Archives a workspace: it leaves every list, and its folder moves to the archived folder. */
export const archiveWorkspace = (id: WorkspaceId) =>
  sendJson({
    path: `/workspaces/${encodeURIComponent(id)}/archive`,
    body: {},
    schema: z.unknown(),
  });

/** Deletes a session and its event log. */
export const deleteSession = (id: SessionId) =>
  sendJson({
    path: `/sessions/${encodeURIComponent(id)}`,
    method: "DELETE",
    body: {},
    schema: z.unknown(),
  });

/** Mark all read (#345): every new reply in the workspace is seen, on every device. */
export const markAllRead = (workspaceId: WorkspaceId) =>
  sendJson({
    path: `/workspaces/${encodeURIComponent(workspaceId)}/seen`,
    body: {},
    schema: z.unknown(),
  });

/** A context file to act on: one workspace's, or the owner context. */
export type ContextPlace =
  | { readonly kind: "workspace"; readonly id: WorkspaceId }
  | { readonly kind: "owner" };

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

/**
 * Continue (#186): the turn a restart cut off carries on, named by its owner message's event
 * number; from a list (Needs you), the session's last turn.
 */
export const continueTurn = (sessionId: SessionId, turn?: number) =>
  sendJson({
    path: `/sessions/${encodeURIComponent(sessionId)}/continue`,
    body: (turn === undefined ? {} : { turn }) satisfies ContinueRequest,
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
