import { SUGGESTED_REPLIES, SUGGESTED_REPLY_MAX_CHARACTERS } from "@courtyard/contract";
import { z } from "zod";
import { err, ok, type Result } from "../result.ts";

/** Why the worker won't show a model's suggested replies (docs/ai-conduct.md, Suggested replies). */
export type RepliesRefusal =
  | { readonly kind: "malformed" }
  | { readonly kind: "count"; readonly count: number }
  | { readonly kind: "not-short" }
  | { readonly kind: "repeated" }
  /** The answer already has its replies: one set per answer. */
  | { readonly kind: "already" }
  | { readonly kind: "stopped" };

const Input = z.object({ replies: z.array(z.string()) });

/** Compared without case or spacing, so "Not yet" and "not  yet" are the same reply. */
const sameness = (reply: string) => reply.toLowerCase().replace(/\s+/g, " ");

/**
 * A model's suggested replies as the chat shows them, each trimmed: two or three, each a few
 * words on one line, all different. Or why not, for the model to put right.
 */
export const checkReplies = (input: unknown): Result<string[], RepliesRefusal> => {
  const parsed = Input.safeParse(input);
  if (!parsed.success) return err({ kind: "malformed" });
  const replies = parsed.data.replies.map((reply) => reply.trim());
  const { atLeast, atMost } = SUGGESTED_REPLIES;
  if (replies.length < atLeast || replies.length > atMost) {
    return err({ kind: "count", count: replies.length });
  }
  const short = (reply: string) =>
    reply !== "" && !/[\r\n]/.test(reply) && reply.length <= SUGGESTED_REPLY_MAX_CHARACTERS;
  if (!replies.every(short)) return err({ kind: "not-short" });
  if (new Set(replies.map(sameness)).size < replies.length) return err({ kind: "repeated" });
  return ok(replies);
};

/**
 * What a model writes after its replies are taken, less any line that repeats one its answer had
 * already written: Claude often writes its whole answer again after the call (#127), while what's
 * new (a recommendation after the question, Get to know's first question) is kept. A line is held
 * back while it could still be a repeat, and what's kept starts a new paragraph.
 */
const unrepeated = (written: string) => {
  const lines = written
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  /** Whether `text`, from the start of a line, could still turn out to be a line written already. */
  const couldRepeat = (text: string) => lines.some((line) => line.startsWith(text.trimStart()));
  /** Whether `text` is a whole line written already. */
  const repeats = (text: string) => lines.includes(text.trim());
  /**
   * What follows a line written already that `text` starts with, ending where a word does (a
   * repeat with new text straight after it), or `undefined` when it starts with none.
   */
  const afterRepeat = (text: string) => {
    const start = text.trimStart();
    const endsWord = (line: string) =>
      !/\w/.test(line.at(-1) ?? "") || !/\w/.test(start.charAt(line.length));
    const repeat = lines
      .filter((line) => start.startsWith(line) && endsWord(line))
      .reduce<string | undefined>(
        (longest, line) => (line.length > (longest?.length ?? -1) ? line : longest),
        undefined,
      );
    return repeat === undefined ? undefined : start.slice(repeat.length);
  };
  /** The line under way while it could be a repeat, or `null` once it's new and passed on. */
  let held: string | null = "";
  /** Line breaks not yet passed on, which go before the next text kept. */
  let breaks = "";
  let keptAny = false;
  const keep = (text: string) => {
    const before = keptAny
      ? breaks
      : written.trim() === "" || written.endsWith("\n\n")
        ? ""
        : written.endsWith("\n")
          ? "\n"
          : "\n\n";
    keptAny = true;
    breaks = "";
    return before + text;
  };
  /** The line held back once it can't be a repeat any more: passed on, less any repeat it starts with. */
  const settle = (line: string) => {
    let rest = line;
    for (;;) {
      if (couldRepeat(rest)) {
        held = rest;
        return "";
      }
      const after = afterRepeat(rest);
      if (after === undefined) {
        held = null;
        return keep(rest);
      }
      rest = after;
    }
  };
  /** The line held back once it's ended, unless it was a repeat. */
  const ended = (line: string | null) =>
    line === null || line.trim() === "" || repeats(line) ? "" : keep(line);
  return {
    /** What to pass on of the next piece of text. */
    take: (text: string) => {
      let out = "";
      for (const piece of text.split(/(\n)/)) {
        if (piece === "\n") {
          out += ended(held);
          breaks += "\n";
          held = "";
        } else if (held === null) {
          if (piece !== "") out += keep(piece);
        } else {
          out += settle(held + piece);
        }
      }
      return out;
    },
    /** What to pass on once the answer is done: a last line held back that wasn't a repeat. */
    end: () => ended(held),
  };
};

/**
 * The suggest replies tool for one turn (docs/ai-conduct.md, Suggested replies), with the answer's
 * text passing through it: it checks each call's replies and records the first set accepted,
 * refusing any after it, and any once the turn is stopped. Once replies are taken, what the model
 * writes is kept apart from what repeats the answer so far.
 */
export const createTurnReplies = (turn: {
  /** Whether the turn is stopped, or can't record any more. */
  stopped: () => boolean;
  record: (replies: readonly string[]) => Promise<void>;
}) => {
  /** The answer as written before its replies were taken. */
  let written = "";
  let after: ReturnType<typeof unrepeated> | undefined;
  return {
    /** A call's replies, recorded once taken, with what the answer had written by then. */
    suggest: async (
      input: unknown,
    ): Promise<Result<{ readonly written: string }, RepliesRefusal>> => {
      if (turn.stopped()) return err({ kind: "stopped" });
      if (after !== undefined) return err({ kind: "already" });
      const checked = checkReplies(input);
      if (!checked.ok) return checked;
      after = unrepeated(written);
      await turn.record(checked.value);
      return ok({ written });
    },
    /** What of the next piece of the answer is kept. */
    kept: (text: string) => {
      if (after !== undefined) return after.take(text);
      written += text;
      return text;
    },
    /** What's left to keep once the answer is done. */
    end: () => after?.end() ?? "",
  };
};
