import { createHash } from "node:crypto";
import { type OldSize, type RecordUnit, SizeQuantity } from "@courtyard/contract";

// Old sizes (#709): sizes written in sentences before sizes were records (a Facts line, a
// project's or the space's history, the space's size), found so the owner can confirm them once.
// Only what's ticked becomes measured; the rest is offered as "about".

/** A sentence to look for sizes in: where it was found and the day it was written, if known. */
export type OldSentence = {
  readonly sentence: string;
  readonly from: string;
  readonly day: string | null;
};

/**
 * A number: with commas between its thousands ("2,650", "2,650.5"), or a decimal point or comma
 * ("2.45", "2,45").
 */
const NUMBER = String.raw`(\d{1,3}(?:,\d{3})+(?:\.\d+)?(?!\d)|\d+(?:[.,]\d+)?)`;
/** A length with its unit, or none when the next one's says it ("5.14 × 2.74 m"). */
const UNIT = String.raw`(mm|cm|m)\b`;
/** Two sides, "5.14 × 2.74 m", "240cm x 180cm", the first maybe without its unit. */
const PAIR = new RegExp(String.raw`${NUMBER}\s*(?:${UNIT})?\s*[×xX]\s*${NUMBER}\s*${UNIT}`, "g");
/** One length with its unit, "2.45 m high". */
const ONE = new RegExp(String.raw`${NUMBER}\s*${UNIT}`, "g");
/** Words that say a size was given roughly, just before it or a word before ("roughly at"). */
const ROUGH =
  /\b(?:about|around|roughly|approx(?:imately)?|circa|nearly|almost)(?:\s+[a-z]+)?\s*~?\s*$|~\s*$/i;

/** Words around a size that say which of a space's sizes it is. */
const NAMED: readonly [RegExp, string][] = [
  [/\b(?:ceiling|high|height|tall)\b/i, "Floor to ceiling"],
  [/\b(?:wide|width|across)\b/i, "Inside width"],
  [/\b(?:long|length|deep|depth)\b/i, "Inside length"],
  [/\bdoor\b/i, "Door width"],
];

const WORDS_BEFORE = /([A-Za-z][A-Za-z' ]{0,40})[:\s-]*$/;
const STOP = new Set([
  "the",
  "a",
  "an",
  "is",
  "are",
  "was",
  "it",
  "its",
  "of",
  "at",
  "and",
  "about",
]);

/**
 * A size's name from the words around it: the word just after it ("2.45 m high"), then those
 * just before ("ceiling height 2.45 m"); "Size" when they say nothing.
 */
const nameOf = (before: string, after: string) => {
  const next = /^\s*([A-Za-z]+)/.exec(after)?.[1] ?? "";
  const named =
    NAMED.find(([words]) => words.test(next)) ??
    NAMED.find(([words]) => words.test(before.slice(-25)));
  if (named !== undefined) return named[1];
  const words = (WORDS_BEFORE.exec(before)?.[1] ?? "")
    .split(/\s+/)
    .filter((word) => word !== "" && !STOP.has(word.toLowerCase()))
    .slice(-3);
  if (words.length === 0) return "Size";
  const name = words.join(" ");
  return `${name[0]?.toUpperCase()}${name.slice(1)}`;
};

/** A number as written: "2,650" is 2650, "2,45" is 2.45. */
const numberOf = (text: string) =>
  Number(
    /^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(text) ? text.replaceAll(",", "") : text.replace(",", "."),
  );

/**
 * A size's key: the same sentence, where and size, the same key each time it's read; a sentence
 * written twice in one place is counted, so each copy's sizes have keys of their own.
 */
const keyOf = (sentence: OldSentence, copy: number, at: number) =>
  createHash("sha256")
    .update(`${sentence.from}\n${sentence.sentence}\n${copy}\n${at}`)
    .digest("hex")
    .slice(0, 16);

/**
 * The sizes in sentences: each length with its unit, a pair of sides ("5.14 × 2.74 m") as its
 * width then its length. Each is named from the words around it and marked rough when it's said
 * so ("about 2650 mm").
 */
export const oldSizesIn = (sentences: readonly OldSentence[]): OldSize[] => {
  const copies = new Map<string, number>();
  return sentences.flatMap((sentence) => {
    const { sentence: text } = sentence;
    const copy = copies.get(`${sentence.from}\n${text}`) ?? 0;
    copies.set(`${sentence.from}\n${text}`, copy + 1);
    const found: (OldSize & { at: number })[] = [];
    const taken: [number, number][] = [];
    const add = (at: number, property: string, value: number, unit: RecordUnit, rough: boolean) => {
      // Only what a record can hold: more than nothing, and no typo's millions.
      const size = SizeQuantity.safeParse({ kind: "quantity", value, unit });
      if (!(value > 0) || !size.success) return;
      found.push({
        at,
        key: keyOf(sentence, copy, at),
        sentence: text,
        from: sentence.from,
        day: sentence.day,
        property,
        value: size.data,
        rough,
      });
    };
    for (const pair of text.matchAll(PAIR)) {
      const [whole, first = "", firstUnit, second = "", unit = "m"] = pair;
      const at = pair.index;
      const before = text.slice(0, at);
      const rough = ROUGH.test(before);
      taken.push([at, at + whole.length]);
      add(at, "Inside width", numberOf(first), (firstUnit ?? unit) as RecordUnit, rough);
      add(at + 1, "Inside length", numberOf(second), unit as RecordUnit, rough);
    }
    for (const one of text.matchAll(ONE)) {
      const at = one.index;
      if (taken.some(([start, end]) => at >= start && at < end)) continue;
      const [whole, value = "", unit = "m"] = one;
      const before = text.slice(0, at);
      const after = text.slice(at + whole.length);
      add(at, nameOf(before, after), numberOf(value), unit as RecordUnit, ROUGH.test(before));
    }
    return found.sort((a, b) => a.at - b.at).map(({ at: _, ...size }) => size);
  });
};
