import {
  ApiError,
  type NewMessage,
  type NewWorkspace,
  type PasswordForm,
  ProviderList,
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
  method?: "POST" | "PATCH";
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

/** Changes a workspace's colour. */
export const changeWorkspace = (id: WorkspaceId, change: WorkspaceChange) =>
  sendJson({
    path: `/workspaces/${encodeURIComponent(id)}`,
    method: "PATCH",
    body: change,
    schema: WorkspaceSummary,
  });

/** Starts a session in a workspace with the owner's first message. */
export const startSession = (workspaceId: WorkspaceId, message: NewMessage) =>
  sendJson({
    path: `/workspaces/${encodeURIComponent(workspaceId)}/sessions`,
    body: message,
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
