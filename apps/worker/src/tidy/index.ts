import { randomUUID } from "node:crypto";
import { join } from "node:path";
import {
  CONTEXT_LINE_MAX_CHARACTERS,
  type FailureReason,
  type LinePlace,
  type ModelRef,
  type PlacedLine,
  type TidyChange,
  TidyId,
  type TidyProposal,
} from "@courtyard/contract";
import { z } from "zod";
import {
  type LabelledLine,
  labelledLines,
  removeContextLine,
  replaceContextLine,
} from "../context-file/index.ts";
import { type ContextFolder, type Place, placeFile } from "../context-folder/index.ts";
import { readTextFile, writeTextFile } from "../files.ts";
import { TIDYING, TidyAnswer, tidyMessage } from "../prompts/index.ts";
import { offerFor, type Provider } from "../providers/index.ts";
import { err, ok, type Result } from "../result.ts";

/**
 * Tidy (ADR 0013, docs/ai-conduct.md Tidying): a model proposes changes that make a long context
 * file shorter, the worker drops any it can't trust, and the ones the owner leaves ticked are saved
 * as one change.
 */

export type TidyTarget = {
  readonly contextDir: string;
  readonly contextFolder: ContextFolder;
  readonly providers: readonly Provider[];
  readonly now: () => number;
};

/** Why a tidy wasn't proposed or saved. */
export type TidyRefusal =
  | { readonly kind: "model-unavailable" }
  | { readonly kind: "failed"; readonly reason: FailureReason }
  /** No such tidy: it was saved, replaced by a newer one, or the worker has restarted since. */
  | { readonly kind: "not-found" }
  /** The file changed after the tidy was proposed, so its changes may not fit it any more. */
  | { readonly kind: "changed-since" }
  | { readonly kind: "storage" };

/** A proposed tidy, kept until it's saved or enough newer ones push it out. */
type Proposed = {
  readonly place: Place;
  /** The file as the model read it. */
  readonly markdown: string;
  readonly changes: readonly TidyChange[];
};

/** A removal's why, as the owner reads it: a few words, never an essay. */
const WHY_MAX_CHARACTERS = 120;

/** Which kind of file a place's file is, as its lines are read. */
const linePlaceOf = (place: Place): LinePlace =>
  place.kind === "owner-context" ? "owner" : "workspace";

/** Words a merge may join lines with, though no line has them. */
const JOINING = new Set([
  "a",
  "an",
  "and",
  "also",
  "as",
  "at",
  "both",
  "but",
  "by",
  "each",
  "for",
  "from",
  "in",
  "is",
  "it",
  "its",
  "of",
  "on",
  "or",
  "plus",
  "the",
  "to",
  "with",
]);

const WORD = /[\p{L}\p{N}]+(?:[.'’][\p{L}\p{N}]+)*/gu;
const wordsOf = (text: string) => text.toLowerCase().match(WORD) ?? [];

const commonStart = (a: string, b: string) => {
  let length = 0;
  while (length < a.length && length < b.length && a[length] === b[length]) length += 1;
  return length;
};

/** Words that turn a meaning round, which must be there already: "doesn't", "not", "never". */
const NEGATING = /n['’]t$|^(?:no|not|never|none|nothing|nobody|neither|nor|without)$/;

/** The shortest word, and the shortest shared start, that counts as a form of another. */
const FORM_LETTERS = 4;

/**
 * Whether a word comes from these: the same word, or a form of one ("lessons" from "lesson": at
 * least four letters in common and at most three more). A word with a digit in it must be there
 * exactly, so no number or date changes, and so must a word that turns a meaning round.
 */
const comesFrom = (word: string, from: readonly string[]) => {
  if (from.includes(word)) return true;
  if (/\p{N}/u.test(word) || NEGATING.test(word)) return false;
  if (JOINING.has(word)) return true;
  return from.some((source) => {
    const shorter = Math.min(source.length, word.length);
    const shared = commonStart(source, word);
    return shorter >= FORM_LETTERS && shared >= FORM_LETTERS && shared >= shorter - 3;
  });
};

/** Whether every word of `text` comes from the lines it replaces: a tidy never adds anything. */
const addsNothing = (text: string, lines: readonly PlacedLine[]) => {
  const from = lines.flatMap((line) => wordsOf(line.line));
  return wordsOf(text).every((word) => comesFrom(word, from));
};

const ProposedChange = TidyAnswer.shape.changes.element;

/**
 * A change the model proposed, checked against the file: its lines by label, each used once in a
 * tidy; one line to remove (with why) or shorten, and two or more in one section to merge; a new
 * line that's short, shorter than what it replaces, and adds nothing. `undefined` for one that
 * fails.
 */
const checked = (
  raw: unknown,
  file: { byLabel: ReadonlyMap<string, LabelledLine>; used: Set<string> },
): Omit<TidyChange, "shortensBy"> | undefined => {
  const proposed = ProposedChange.safeParse(raw);
  if (!proposed.success) return undefined;
  const { kind, labels, text, why } = proposed.data;
  // A label as it's shown ("[F1]") is still that label.
  const found = labels.map((label) =>
    file.byLabel.get(label.replace(/[[\]\s]/g, "").toUpperCase()),
  );
  const labelled = found.filter((line) => line !== undefined);
  if (labelled.length !== labels.length || labelled.some(({ label }) => file.used.has(label))) {
    return undefined;
  }
  if (new Set(labelled.map(({ label }) => label)).size !== labelled.length) return undefined;
  const lines = labelled.map(({ label: _, ...line }): PlacedLine => line);
  const [first] = lines;
  if (first === undefined) return undefined;

  let change: Omit<TidyChange, "shortensBy">;
  if (kind === "remove") {
    if (lines.length !== 1) return undefined;
    // The owner decides on a removal by its reason, so one without is dropped.
    const reason = why?.replace(/\s+/g, " ").trim().slice(0, WHY_MAX_CHARACTERS) ?? "";
    if (reason === "") return undefined;
    change = { kind, lines, why: reason };
  } else {
    const line = text?.replace(/\s+/g, " ").trim() ?? "";
    if (line === "" || line.length > CONTEXT_LINE_MAX_CHARACTERS) return undefined;
    if (!addsNothing(line, lines)) return undefined;
    if (kind === "shorten" && (lines.length !== 1 || line.length >= first.line.length)) {
      return undefined;
    }
    const oneSection = lines.every(
      (other) => other.place === first.place && other.section === first.section,
    );
    if (kind === "merge" && (lines.length < 2 || !oneSection)) return undefined;
    change = { kind, lines, text: line };
  }
  for (const { label } of labelled) file.used.add(label);
  return change;
};

/**
 * A file with one change made: the merged or shortened line where the first of its lines was, the
 * rest taken out. `undefined` when a line isn't there as worded.
 */
const withChange = (markdown: string, change: Omit<TidyChange, "shortensBy">) => {
  const [first, ...rest] = change.lines;
  if (first === undefined) return undefined;
  let now =
    change.text === undefined
      ? removeContextLine(markdown, first)
      : replaceContextLine(markdown, { was: first, now: { ...first, line: change.text } });
  for (const line of rest) now = now === undefined ? now : removeContextLine(now, line);
  return now;
};

/** The model's answer as a list of changes, or `undefined` when it isn't one. */
const AnswerList = z.object({ changes: z.array(z.unknown()) });

/**
 * How many proposed tidies are held. Older ones go; one of the same file as a newer tidy that's
 * been saved is refused anyway, as the file has changed since.
 */
const PROPOSALS_HELD = 20;

/** Proposing and saving tidies; it holds the latest proposals until they're saved. */
export const createTidying = (target: TidyTarget) => {
  const proposed = new Map<TidyId, Proposed>();
  const fileOf = (place: Place) => join(target.contextDir, placeFile(place));

  return {
    /** Asks the model for a tidy of a place's file and checks each change it proposes. */
    propose: async (request: {
      place: Place;
      model: ModelRef;
      signal: AbortSignal;
    }): Promise<Result<TidyProposal, TidyRefusal>> => {
      const { place, model, signal } = request;
      const provider = (await offerFor(target.providers, model))?.provider;
      if (provider === undefined) return err({ kind: "model-unavailable" });
      const read = await readTextFile(fileOf(place));
      if (!read.ok) return err({ kind: "storage" });
      const markdown = read.value ?? "";
      const linePlace = linePlaceOf(place);
      const lines = labelledLines(markdown, linePlace);

      let changes: Omit<TidyChange, "shortensBy">[] = [];
      if (lines.length > 0) {
        const answer = await provider.answerOnce({
          purpose: "tidy",
          model: model.model,
          instructions: TIDYING,
          message: tidyMessage({ markdown, place: linePlace, now: target.now() }),
          schema: TidyAnswer,
          signal,
        });
        if (!answer.ok) return err({ kind: "failed", reason: answer.error });
        const list = AnswerList.safeParse(answer.value);
        if (!list.success) {
          return err({
            kind: "failed",
            reason: { kind: "unknown", message: "The model's tidy came back in the wrong shape." },
          });
        }
        const file = {
          byLabel: new Map(lines.map((line) => [line.label, line])),
          used: new Set<string>(),
        };
        changes = list.data.changes.flatMap((raw) => checked(raw, file) ?? []);
      }

      const sized = changes.flatMap((change): TidyChange[] => {
        const after = withChange(markdown, change);
        const shortensBy = after === undefined ? 0 : markdown.length - after.length;
        // A tidy only makes the file shorter: a merge as long as its lines is no tidy.
        return shortensBy > 0 ? [{ ...change, shortensBy }] : [];
      });
      // Maps keep their order, so the first is the oldest.
      for (const [held] of proposed) {
        if (proposed.size < PROPOSALS_HELD) break;
        proposed.delete(held);
      }
      const id = TidyId.parse(randomUUID());
      proposed.set(id, { place, markdown, changes: sized });
      return ok({ id, changes: sized, characters: markdown.length });
    },

    /**
     * Saves the changes the owner kept, by their place in the proposal, as one change: refused
     * when the file has changed since the tidy was proposed. Either way, the tidy is done with.
     */
    save: async (request: {
      id: TidyId;
      keep: readonly number[];
    }): Promise<Result<null, TidyRefusal>> => {
      const tidy = proposed.get(request.id);
      if (tidy === undefined) return err({ kind: "not-found" });
      const kept = tidy.changes.filter((_, index) => request.keep.includes(index));
      const saved = await target.contextFolder.change(
        async (): Promise<Result<number, TidyRefusal>> => {
          const read = await readTextFile(fileOf(tidy.place));
          if (!read.ok) return err({ kind: "storage" });
          if ((read.value ?? "") !== tidy.markdown) return err({ kind: "changed-since" });
          if (kept.length === 0) return ok(0);
          let markdown: string | undefined = tidy.markdown;
          for (const change of kept) {
            markdown = markdown === undefined ? markdown : withChange(markdown, change);
          }
          if (markdown === undefined) return err({ kind: "changed-since" });
          const written = await writeTextFile(fileOf(tidy.place), markdown);
          return written.ok ? ok(kept.length) : err({ kind: "storage" });
        },
        (count) => ({
          kind: "tidy",
          title: `Tidy: ${count} ${count === 1 ? "change" : "changes"}`,
          places: [tidy.place],
        }),
      );
      if (saved.ok || saved.error.kind === "changed-since") proposed.delete(request.id);
      return saved.ok ? ok(null) : saved;
    },
  };
};

export type Tidying = ReturnType<typeof createTidying>;
