import { ApiError } from "@courtyard/contract";
import { z } from "zod";

/** What came back from the worker: the data, or why there isn't any. */
export type FromWorker<T> =
  | { readonly kind: "loaded"; readonly data: T }
  | { readonly kind: "not-found" }
  | { readonly kind: "logged-out" }
  | { readonly kind: "failed"; readonly status: number; readonly message: string }
  | { readonly kind: "offline" };

const answer = async <T>(response: Response, schema: z.ZodType<T>): Promise<FromWorker<T>> => {
  if (response.status === 404) return { kind: "not-found" };
  if (response.status === 401) return { kind: "logged-out" };
  const body: unknown = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const error = ApiError.safeParse(body);
    return error.success
      ? { kind: "failed", status: response.status, message: error.data.error }
      : { kind: "offline" };
  }
  const parsed = schema.safeParse(body);
  return parsed.success ? { kind: "loaded", data: parsed.data } : { kind: "offline" };
};

/**
 * Asks the worker's API and parses the answer with the contract's schema. A worker that can't be
 * reached, or answers with something unexpected, counts as offline; a worker that answers with an
 * error says what went wrong.
 */
export const fromWorker = async <T>(path: string, schema: z.ZodType<T>): Promise<FromWorker<T>> => {
  try {
    return await answer(await fetch(`/api${path}`), schema);
  } catch {
    return { kind: "offline" };
  }
};

/** Sends JSON to the worker's API. A success with no body comes back as loaded `null`. */
export const toWorker = async (path: string, body: unknown): Promise<FromWorker<unknown>> => {
  try {
    const response = await fetch(`/api${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return await answer(response, z.unknown());
  } catch {
    return { kind: "offline" };
  }
};
