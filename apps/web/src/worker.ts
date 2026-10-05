import {
  ApiError,
  type NewMessage,
  type PasswordForm,
  ProviderList,
  type SessionId,
  SessionSummary,
  type WorkspaceId,
} from "@courtyard/contract";
import { z } from "zod";

/** What came back from the worker: the data, or why there isn't any. */
export type FromWorker<T> =
  | { readonly kind: "loaded"; readonly data: T }
  | { readonly kind: "not-found" }
  | { readonly kind: "logged-out" }
  | { readonly kind: "failed"; readonly message: string }
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
    : { kind: "failed", message: error.data.error };
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

/** Posts JSON to the worker's API and reads the answer with `schema`. */
const post = async <T>(request: {
  path: string;
  body: unknown;
  schema: z.ZodType<T>;
  unauthorised?: "logged-out" | "failed";
}): Promise<FromWorker<T>> => {
  try {
    const response = await fetch(`/api${request.path}`, {
      method: "POST",
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
  post({ path, body: form, schema: z.unknown(), unauthorised: "failed" });

export const logOut = () => post({ path: "/logout", body: {}, schema: z.unknown() });
export const logOutOthers = () => post({ path: "/logout-others", body: {}, schema: z.unknown() });

/** The providers and their models, for the model picker. */
export const loadProviders = () => fromWorker("/providers", ProviderList);

/** Starts a session in a workspace with the owner's first message. */
export const startSession = (workspaceId: WorkspaceId, message: NewMessage) =>
  post({
    path: `/workspaces/${encodeURIComponent(workspaceId)}/sessions`,
    body: message,
    schema: SessionSummary,
  });

/** Sends the next message in a session. */
export const sendMessage = (sessionId: SessionId, message: NewMessage) =>
  post({
    path: `/sessions/${encodeURIComponent(sessionId)}/messages`,
    body: message,
    schema: z.unknown(),
  });
