import { ApiError } from "@courtyard/contract";
import type { z } from "zod";
import { type FromWorker, readResponse } from "./worker.ts";

// Waiting on a worker that's slow to answer (#204): a busy worker machine isn't a missing one.
// Beside `worker.ts` rather than in it: only an approval's answer waits like this, so none of it
// is on the first load.

/** How long a worker that gives no answer is tried again, quietly, before it counts as unreachable. */
const WAIT_FOR_WORKER_MS = 30_000;
/** A try that fails faster than this found nothing there: refused, or a dropped connection. */
const QUICK_FAILURE_MS = 1000;
/** How many quick failures in a row mean the connection is refused, rather than one dropped. */
const REFUSED_AFTER = 3;
const FIRST_RETRY_MS = 250;
const LONGEST_RETRY_MS = 4000;
/** How long an answer can take before the page says it's waiting for it. */
const SLOW_ANSWER_MS = 1500;
/** How often a kept answer is tried again once the worker counts as unreachable. */
const UNREACHABLE_RETRY_MS = 3000;

/** What to do after a try the worker gave no answer to: try again, or say it can't be reached. */
export type Verdict =
  | { readonly kind: "retry"; readonly afterMs: number }
  | { readonly kind: "unreachable" };

/**
 * Decides after a try the worker gave no answer to. `failed` is how long each failed try took,
 * oldest first. A network that's down, or a connection refused (quick failures, several in a row),
 * can't be reached now; anything else is a slow worker, tried again with longer waits each time,
 * until `WAIT_FOR_WORKER_MS` has gone.
 */
export const afterNoAnswer = (tries: {
  failed: readonly number[];
  sinceFirstMs: number;
  online: boolean;
}): Verdict => {
  const lastFew = tries.failed.slice(-REFUSED_AFTER);
  const refused =
    lastFew.length === REFUSED_AFTER && lastFew.every((tookMs) => tookMs < QUICK_FAILURE_MS);
  const left = WAIT_FOR_WORKER_MS - tries.sinceFirstMs;
  if (!tries.online || refused || left <= 0) return { kind: "unreachable" };
  const backoff = FIRST_RETRY_MS * 2 ** (tries.failed.length - 1);
  return { kind: "retry", afterMs: Math.min(backoff, LONGEST_RETRY_MS, left) };
};

/** How a patient request is going, while it has no answer: slow, or the worker unreachable. */
export type Waiting = "slow" | "unreachable";

/** One try: the worker's own answer, or nothing when it gave none (a proxy answering for it). */
const tryOnce = async (path: string, body: unknown, signal: AbortSignal) => {
  try {
    const response = await fetch(`/api${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
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

/** Waits `ms`, or less when `signal` stops the waiting. */
const pause = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });

/**
 * Sends JSON to the worker's API, only for something that's harmless to send twice (an approval's
 * answer), and keeps it until the worker answers: tried again quietly while the worker is slow,
 * and still every few seconds once it counts as unreachable. `onWaiting` says which, for the page
 * to show. It ends early only when `signal` stops it, as offline.
 */
export const sendPatiently = async <T>(request: {
  path: string;
  body: unknown;
  schema: z.ZodType<T>;
  onWaiting: (waiting: Waiting) => void;
  signal: AbortSignal;
}): Promise<FromWorker<T>> => {
  const { signal } = request;
  const first = Date.now();
  const failed: number[] = [];
  let unreachable = false;
  const slow = setTimeout(() => request.onWaiting("slow"), SLOW_ANSWER_MS);
  try {
    while (!signal.aborted) {
      const started = Date.now();
      const response = await tryOnce(request.path, request.body, signal);
      if (response !== undefined)
        return await readResponse({ response, schema: request.schema, unauthorised: "logged-out" });
      failed.push(Date.now() - started);
      let afterMs = UNREACHABLE_RETRY_MS;
      if (!unreachable) {
        const verdict = afterNoAnswer({
          failed,
          sinceFirstMs: Date.now() - first,
          online: navigator.onLine,
        });
        if (verdict.kind === "retry") afterMs = verdict.afterMs;
        else {
          unreachable = true;
          clearTimeout(slow);
          request.onWaiting("unreachable");
        }
      }
      await pause(afterMs, signal);
    }
    return { kind: "offline" };
  } finally {
    clearTimeout(slow);
  }
};
