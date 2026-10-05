import { ModelId, ProviderId } from "@courtyard/contract";
import { err, ok } from "../result.ts";
import type { Provider } from "./index.ts";

const id = ProviderId.parse("fake");

/**
 * A scripted provider, so everything runs end to end with no models installed and no usage
 * (story 90). It answers "You said: …" a word at a time, and fails on purpose when a message asks
 * it to ("please fail"), so failures can be seen and tested.
 */
export const createFakeProvider = (
  options: {
    /** Pause between words, so streaming is visible. */
    delayMs?: number;
    /** Awaited before answering; tests use it to hold a turn open. */
    beforeReply?: () => Promise<void>;
  } = {},
): Provider => {
  const delayMs = options.delayMs ?? 40;

  return {
    id,
    status: async () => ({
      id,
      label: "Fake",
      available: true,
      models: [{ id: ModelId.parse("echo"), label: "Fake (echoes you)" }],
      capabilities: { readsFiles: false, codes: false, usesTools: false },
    }),

    runTurn: async ({ lines, emit }) => {
      await options.beforeReply?.();
      const last = lines.at(-1)?.text ?? "";
      if (/please fail/i.test(last)) {
        return err({
          kind: "unknown",
          message: "The fake provider failed on purpose, because the message asked it to.",
        });
      }
      for (const word of `You said: ${last}`.split(/(?<= )/)) {
        if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
        await emit(word);
      }
      return ok(null);
    },
  };
};
