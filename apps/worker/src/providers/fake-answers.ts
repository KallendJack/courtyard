import { COMMON_TOOLS, type FailureReason } from "@courtyard/contract";
import { err, ok, type Result } from "../lib/result.ts";
import type { OneOffInput } from "./index.ts";

// The fake provider's answers to one-off questions (`answerOnce`), each scripted by what it's
// asked, so the features that ask them can be tried and tested with no real model.

/** How many words of the owner's first message a scripted title keeps. */
const TITLE_WORDS = 5;

/**
 * The title a session's first message scripts: its first few words in title case ("Where should
 * the rack go?" is "Where Should The Rack Go"). "no title please" fails on purpose.
 */
const scriptedTitle = (message: string): Result<{ title: string }, FailureReason> => {
  const first = /^Owner: (.*)$/m.exec(message)?.[1] ?? "";
  if (/no title please/i.test(first)) {
    return err({
      kind: "unknown",
      message: "The fake didn't title it, because it was asked not to.",
    });
  }
  const words = first.match(/[\p{L}\p{N}']+/gu) ?? [];
  const title = words
    .slice(0, TITLE_WORDS)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
  return ok({ title });
};

const NOTE_LINE = /\b(done|decided|next): ([^;\n]+)/gi;

/**
 * The note a session's conversation scripts (#601): each line as the message last names it,
 * "done: …", "decided: …" and "next: …" ending at a semicolon or the line's end, so the
 * conversation's words win over the note it carries on from; empty for one it doesn't name. "no
 * note please" fails on purpose.
 */
const scriptedNote = (message: string): Result<Record<string, string>, FailureReason> => {
  if (/no note please/i.test(message)) {
    return err({
      kind: "unknown",
      message: "The fake didn't write a note, because it was asked not to.",
    });
  }
  const note: Record<string, string> = { done: "", decided: "", next: "" };
  for (const [, line = "", text = ""] of message.matchAll(NOTE_LINE)) {
    note[line.toLowerCase()] = text.trim();
  }
  return ok(note);
};

const POINT_AT = /point at (\S+) line (\d+)/gi;

/**
 * The answer a quick question about a pull request scripts (#327): "You asked: …", pointing at
 * each line it names as "point at <path> line <n>". "please fail" fails on purpose.
 */
const scriptedQuickAnswer = (message: string): Result<unknown, FailureReason> => {
  const question = /The owner's question: (.*)$/s.exec(message)?.[1] ?? "";
  if (/please fail/i.test(question)) {
    return err({
      kind: "unknown",
      message: "The fake didn't answer, because it was asked not to.",
    });
  }
  const lines = [...question.matchAll(POINT_AT)].map(([, path = "", line = "0"]) => ({
    path,
    line: Number(line),
  }));
  return ok({ answer: `You asked: ${question}`, lines });
};

/** Counts said in words, as "two clamps" says one. */
const COUNT_WORDS = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

/**
 * The tools "Or just say it" scripts (#707): each piece of what was said, between commas and
 * "and", with any "a", "the" or "my" in front and a count ("two" or 2) read off; a tile whose name
 * it is, plural or not, by that name, any other by its own. "please fail" fails on purpose.
 */
const scriptedHeardTools = (message: string): Result<unknown, FailureReason> => {
  const said = /<said>\n([\s\S]*)\n<\/said>/.exec(message)?.[1] ?? "";
  if (/please fail/i.test(said)) {
    return err({
      kind: "unknown",
      message: "The fake didn't answer, because it was asked not to.",
    });
  }
  const tiles: readonly string[] = COMMON_TOOLS.flatMap(({ tools }) => tools);
  const tools = said
    .split(/,|\band\b/i)
    .map((piece) => piece.trim().replace(/^(?:a|an|the|my)\s+/i, ""))
    .filter((piece) => piece !== "")
    .map((piece) => {
      const [first = "", ...rest] = piece.split(/\s+/);
      const worded = COUNT_WORDS.indexOf(first.toLowerCase()) + 1;
      const counted = worded > 0 || /^\d+$/.test(first);
      const count = worded > 0 ? worded : counted ? Number(first) : 1;
      const named = counted ? rest.join(" ") : piece;
      const tile = tiles.find((one) =>
        [one.toLowerCase(), `${one.toLowerCase()}s`].includes(named.toLowerCase()),
      );
      return { name: tile ?? `${named.charAt(0).toUpperCase()}${named.slice(1)}`, count };
    });
  return ok({ tools });
};

/** The fake's answer to a one-off question, by what it's for. */
export const scriptedAnswer = (
  purpose: OneOffInput["purpose"],
  message: string,
): Result<unknown, FailureReason> => {
  switch (purpose) {
    case "title":
      return scriptedTitle(message);
    case "quick-question":
      return scriptedQuickAnswer(message);
    case "session-note":
      return scriptedNote(message);
    case "heard-tools":
      return scriptedHeardTools(message);
  }
};
