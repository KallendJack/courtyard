import { setTimeout as wait } from "node:timers/promises";
import { type Capabilities, Effort, ModelId, ProviderId } from "@courtyard/contract";
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

/** The levels of effort the fake's model takes, so picking one can be seen and tested. */
const EFFORTS = [
  { id: Effort.parse("low"), label: "Low" },
  { id: Effort.parse("medium"), label: "Medium" },
  { id: Effort.parse("high"), label: "High" },
];

const SECTIONS = {
  fact: "facts",
  plan: "plans",
  idea: "ideas",
  preference: "answers",
} as const;
const ADD = /^save (owner )?(fact|plan|idea|preference): (.+)$/i;
const CHANGE = /^change (\w+) to (owner )?(fact|plan|idea|preference): (.+)$/i;
const REMOVE = /^remove (\w+)$/i;

/**
 * Where a scripted save goes: "owner fact" is About me and "preference" How to answer me. Without
 * "owner", it names no place, as a model needn't: an added line goes to the workspace and a
 * changed one stays where it is.
 */
const whereTo = (owner: string | undefined, word: string) => {
  const lower = word.toLowerCase();
  const section =
    SECTIONS[lower === "plan" || lower === "idea" || lower === "preference" ? lower : "fact"];
  return owner ? { place: "owner", section } : { section };
};

/**
 * The saves a message scripts, one per line: "save fact: …", "save owner fact: …", "save
 * preference: …", "change F1 to plan: …", "remove I2".
 */
const scriptedSaves = (message: string): Record<string, string>[] =>
  message.split("\n").flatMap((line): Record<string, string>[] => {
    const text = line.trim();
    const add = ADD.exec(text);
    if (add?.[2] && add[3]) return [{ action: "add", ...whereTo(add[1], add[2]), text: add[3] }];
    const change = CHANGE.exec(text);
    if (change?.[1] && change[3] && change[4]) {
      return [
        {
          action: "change",
          ...whereTo(change[2], change[3]),
          label: change[1],
          text: change[4],
        },
      ];
    }
    const remove = REMOVE.exec(text);
    return remove?.[1] ? [{ action: "remove", label: remove[1] }] : [];
  });

/** A labelled line as a model reads it: `- [F2] The ceiling is 2.3 m`. */
const LABELLED = /\[([A-Z]+)(\d+)\] (.+)$/;

/**
 * The tidy a file scripts, by markers at the end of its lines: "(stale)" is removed, "(long)" is
 * shortened to the line without the marker, the lines of a section ending "(merge)" are merged
 * into one, and "(adds)" is shortened to "A sauna", a change that adds something new.
 */
const scriptedTidy = (message: string) => {
  const changes: Record<string, unknown>[] = [];
  const merging = new Map<string, { labels: string[]; texts: string[] }>();
  for (const line of message.split("\n")) {
    const [, letters, number, text] = LABELLED.exec(line.trim()) ?? [];
    if (letters === undefined || text === undefined) continue;
    const label = `${letters}${number}`;
    const marked = /^(.*) \((stale|long|merge|adds)\)$/.exec(text);
    const [, words = text, marker] = marked ?? [];
    if (marker === "stale") changes.push({ kind: "remove", labels: [label], why: "It's stale." });
    if (marker === "long") changes.push({ kind: "shorten", labels: [label], text: words });
    if (marker === "adds") changes.push({ kind: "shorten", labels: [label], text: "A sauna" });
    if (marker === "merge") {
      const merge = merging.get(letters) ?? { labels: [], texts: [] };
      merge.labels.push(label);
      merge.texts.push(words);
      merging.set(letters, merge);
    }
  }
  for (const { labels, texts } of merging.values()) {
    if (labels.length > 1) changes.push({ kind: "merge", labels, text: texts.join(", ") });
  }
  return { changes };
};

/** Waits `ms`, or less if the turn is stopped first. */
const pause = (ms: number, signal: AbortSignal) =>
  wait(ms, undefined, { signal }).catch(() => undefined);

/**
 * A scripted provider, so everything runs end to end with no models installed and no usage
 * (story 90). It answers "You said: …" a word at a time, and fails on purpose when a message asks
 * it to ("please fail"), so failures can be seen and tested. "please read" reports reading the
 * context file, so activity can be too, and lines such as "save fact: …" make saves (see
 * `scriptedSaves`) when the turn offers the save tool. A tidy follows markers in the file (see
 * `scriptedTidy`).
 */
export const createFakeProvider = (
  options: {
    /** Pause between words, so streaming is visible. */
    delayMs?: number;
    /** Awaited before answering; tests use it to hold a turn open. */
    beforeReply?: (signal: AbortSignal) => Promise<void>;
    /** Told the model and effort of each turn, so tests can see what reached the model. */
    heard?: (turn: { model: ModelId; effort: Effort | undefined }) => void;
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
      models: [
        {
          id: ModelId.parse("echo"),
          label: "Fake (echoes you)",
          efforts: EFFORTS,
          defaultEffort: Effort.parse("medium"),
        },
      ],
      capabilities: CAPABILITIES,
    }),

    runTurn: async ({ model, effort, framing, emit, report, save, signal }) => {
      options.heard?.({ model, effort });
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

    answerOnce: async ({ purpose, message, signal }) => {
      if (delayMs > 0) await pause(delayMs * 10, signal);
      if (signal.aborted) return err({ kind: "unknown", message: "Stopped." });
      switch (purpose) {
        case "tidy":
          return ok(scriptedTidy(message));
      }
    },
  };
};
