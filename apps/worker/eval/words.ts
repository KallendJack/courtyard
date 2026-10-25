import type { Words } from "./scenarios.ts";

// How the context eval reads words in what a model wrote: each word, or any one of a list.

const anyOf = (word: string | readonly string[]) => (typeof word === "string" ? [word] : word);

/** Whether text has every word (any one of a list) and none of the words it must not. */
export const hasWords = (
  text: string,
  has: { words: Words; without?: readonly string[] | undefined },
) => {
  const lower = text.toLowerCase();
  return (
    has.words.every((word) => anyOf(word).some((either) => lower.includes(either))) &&
    !(has.without ?? []).some((word) => lower.includes(word))
  );
};

export const describeWords = (words: Words) =>
  words.map((word) => anyOf(word).join(" or ")).join(", ");
