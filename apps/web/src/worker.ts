import { ApiError } from "@courtyard/contract";
import type { z } from "zod";

/** What came back from the worker: the data, or why there isn't any. */
export type FromWorker<T> =
  | { readonly kind: "loaded"; readonly data: T }
  | { readonly kind: "not-found" }
  | { readonly kind: "failed"; readonly message: string }
  | { readonly kind: "offline" };

/**
 * Fetches from the worker's API and parses the answer with the contract's schema. A worker that
 * can't be reached, or answers with something unexpected, counts as offline; a worker that
 * answers with an error says what went wrong.
 */
export const fromWorker = async <T>(path: string, schema: z.ZodType<T>): Promise<FromWorker<T>> => {
  try {
    const response = await fetch(`/api${path}`);
    const body: unknown = await response.json();
    if (response.status === 404) return { kind: "not-found" };
    if (!response.ok) {
      const error = ApiError.safeParse(body);
      return error.success ? { kind: "failed", message: error.data.error } : { kind: "offline" };
    }
    const parsed = schema.safeParse(body);
    return parsed.success ? { kind: "loaded", data: parsed.data } : { kind: "offline" };
  } catch {
    return { kind: "offline" };
  }
};
