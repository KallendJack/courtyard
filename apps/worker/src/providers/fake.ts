import { setTimeout as wait } from "node:timers/promises";
import { type Capabilities, ModelId, ProviderId } from "@courtyard/contract";
import { err, ok } from "../result.ts";
import type { Provider } from "./index.ts";

const id = ProviderId.parse("fake");
/** The fake reads nothing; it only echoes. */
const CAPABILITIES: Capabilities = { readsFiles: false, codes: false, usesTools: false };

/** Waits `ms`, or less if the turn is stopped first. */
const pause = (ms: number, signal: AbortSignal) =>
  wait(ms, undefined, { signal }).catch(() => undefined);

/**
 * A scripted provider, so everything runs end to end with no models installed and no usage
 * (story 90). It answers "You said: …" a word at a time, and fails on purpose when a message asks
 * it to ("please fail"), so failures can be seen and tested. "please read" reports reading the
 * context file, so activity can be too.
 */
export const createFakeProvider = (
  options: {
    /** Pause between words, so streaming is visible. */
    delayMs?: number;
    /** Awaited before answering; tests use it to hold a turn open. */
    beforeReply?: (signal: AbortSignal) => Promise<void>;
  } = {},
): Provider => {
  const delayMs = options.delayMs ?? 40;

  return {
    id,
    capabilities: CAPABILITIES,
    status: async () => ({
      id,
      label: "Fake",
      available: true,
      models: [{ id: ModelId.parse("echo"), label: "Fake (echoes you)" }],
      capabilities: CAPABILITIES,
    }),

    runTurn: async ({ framing, emit, report, signal }) => {
      await options.beforeReply?.(signal);
      if (signal.aborted) return ok(null);
      const last = framing.newMessage;
      if (/please read/i.test(last)) await report({ kind: "read-file", path: "CONTEXT.md" });
      if (/please fail/i.test(last)) {
        return err({
          kind: "unknown",
          message: "The fake provider failed on purpose, because the message asked it to.",
        });
      }
      for (const word of `You said: ${last}`.split(/(?<= )/)) {
        if (delayMs > 0) await pause(delayMs, signal);
        if (signal.aborted) return ok(null);
        await emit(word);
      }
      return ok(null);
    },
  };
};
