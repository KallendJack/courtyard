import { ApiError, type PasswordForm } from "@courtyard/contract";
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
const readResponse = async <T>(
  response: Response,
  schema: z.ZodType<T>,
  unauthorised: "logged-out" | "failed" = "logged-out",
): Promise<FromWorker<T>> => {
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
    return await readResponse(await fetch(`/api${path}`), schema);
  } catch {
    return { kind: "offline" };
  }
};

/** What the web app sends to the worker, by path. */
type Sent = {
  "/setup": PasswordForm;
  "/login": PasswordForm;
  "/logout": Record<string, never>;
  "/logout-others": Record<string, never>;
};

/** Sends a change to the worker's API as JSON. Success carries no data. */
export const toWorker = async <P extends keyof Sent>(
  path: P,
  body: Sent[P],
): Promise<FromWorker<unknown>> => {
  try {
    const response = await fetch(`/api${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const passwordForm = path === "/setup" || path === "/login";
    return await readResponse(response, z.unknown(), passwordForm ? "failed" : "logged-out");
  } catch {
    return { kind: "offline" };
  }
};
