import { setTimeout as wait } from "node:timers/promises";
import { type Capabilities, ModelId, ProviderId } from "@courtyard/contract";
import { err, ok } from "../result.ts";
import type { Provider } from "./index.ts";

const id = ProviderId.parse("fake");
/** The fake reads nothing; it echoes, and saves when a message scripts it. */
const CAPABILITIES: Capabilities = {
  readsFiles: false,
  codes: false,
  usesTools: false,
  savesContext: true,
};

const SECTIONS = { fact: "facts", plan: "plans", idea: "ideas" } as const;
const ADD = /^save (fact|plan|idea): (.+)$/i;
const CHANGE = /^change (\w+) to (fact|plan|idea): (.+)$/i;
const REMOVE = /^remove (\w+)$/i;

const sectionOf = (word: string) => {
  const lower = word.toLowerCase();
  return SECTIONS[lower === "plan" || lower === "idea" ? lower : "fact"];
};

/** The saves a message scripts, one per line: "save fact: …", "change F1 to plan: …", "remove I2". */
const scriptedSaves = (message: string): Record<string, string>[] =>
  message.split("\n").flatMap((line): Record<string, string>[] => {
    const text = line.trim();
    const add = ADD.exec(text);
    if (add?.[1] && add[2]) return [{ action: "add", section: sectionOf(add[1]), text: add[2] }];
    const change = CHANGE.exec(text);
    if (change?.[1] && change[2] && change[3]) {
      return [
        { action: "change", section: sectionOf(change[2]), label: change[1], text: change[3] },
      ];
    }
    const remove = REMOVE.exec(text);
    return remove?.[1] ? [{ action: "remove", label: remove[1] }] : [];
  });

/** Waits `ms`, or less if the turn is stopped first. */
const pause = (ms: number, signal: AbortSignal) =>
  wait(ms, undefined, { signal }).catch(() => undefined);

/**
 * A scripted provider, so everything runs end to end with no models installed and no usage
 * (story 90). It answers "You said: …" a word at a time, and fails on purpose when a message asks
 * it to ("please fail"), so failures can be seen and tested. "please read" reports reading the
 * context file, so activity can be too, and lines such as "save fact: …" make saves (see
 * `scriptedSaves`) when the turn offers the save tool.
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

    runTurn: async ({ framing, emit, report, save, signal }) => {
      await options.beforeReply?.(signal);
      if (signal.aborted) return ok(null);
      const last = framing.newMessage;
      if (/please read/i.test(last)) await report({ kind: "read-file", path: "CONTEXT.md" });
      if (framing.saveTool !== null) {
        for (const request of scriptedSaves(last)) await save(request);
      }
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
