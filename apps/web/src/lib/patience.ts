import type { z } from "zod";
import { type FromWorker, readResponse, tryOnce, untilAnswered } from "../api/worker.ts";

// Keeping an answer for a worker that can't be reached (#204). Beside `worker.ts` rather than in
// it: only an approval's answer is kept like this, so none of it is on the first load. Waiting for
// a slow worker, which every request to it does, is `untilAnswered` in `worker.ts`.

/** How long an answer can take before the page says it's waiting for it. */
const SLOW_ANSWER_MS = 1500;
/** How often a kept answer is tried again once the worker counts as unreachable. */
const UNREACHABLE_RETRY_MS = 3000;

/** How a patient request is going, while it has no answer: slow, or the worker unreachable. */
export type Waiting = "slow" | "unreachable";

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
  const send = () =>
    fetch(`/api${request.path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request.body),
      signal,
    });
  const slow = setTimeout(() => request.onWaiting("slow"), SLOW_ANSWER_MS);
  try {
    let response = await untilAnswered(send, signal);
    if (!response && !signal.aborted) {
      clearTimeout(slow);
      request.onWaiting("unreachable");
    }
    while (!response && !signal.aborted) {
      await pause(UNREACHABLE_RETRY_MS, signal);
      if (!signal.aborted) response = await tryOnce(send);
    }
    return response
      ? await readResponse({ response, schema: request.schema, unauthorised: "logged-out" })
      : { kind: "offline" };
  } finally {
    clearTimeout(slow);
  }
};
