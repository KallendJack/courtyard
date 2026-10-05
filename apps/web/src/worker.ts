import type { z } from "zod";

/** What came back from the worker: the data, or why there isn't any. */
export type FromWorker<T> =
  | { readonly kind: "loaded"; readonly data: T }
  | { readonly kind: "offline" }
  | { readonly kind: "not-found" };

/**
 * Fetches from the worker's API and parses the answer with the contract's schema. A worker that
 * can't be reached, or answers with something unexpected, counts as offline.
 */
export const fromWorker = async <T>(path: string, schema: z.ZodType<T>): Promise<FromWorker<T>> => {
  try {
    const response = await fetch(`/api${path}`);
    if (response.status === 404) return { kind: "not-found" };
    if (!response.ok) return { kind: "offline" };
    const parsed = schema.safeParse(await response.json());
    return parsed.success ? { kind: "loaded", data: parsed.data } : { kind: "offline" };
  } catch {
    return { kind: "offline" };
  }
};
