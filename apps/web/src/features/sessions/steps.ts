/** One step of an answer with steps: its first sentence, and the rest of it in a line. */
export type Step = { readonly title: string; readonly detail: string };

/**
 * An answer's steps, for step by step (#241): what they're for, when the answer says so in a few
 * words (a heading, or a short line ending in ":" just above them), and the steps in order.
 */
export type Steps = { readonly about: string | undefined; readonly steps: readonly Step[] };

/** Fewer numbered lines than this are a short list, not steps to take one at a time. */
const LEAST_STEPS = 3;
/** A line above the steps longer than this is a sentence about them, not what they're for. */
const MOST_ABOUT_WORDS = 6;

const ITEM = /^ {0,3}(\d{1,3})[.)]\s+(.*)$/;
const HEADING = /^ {0,3}#{1,6}\s+(.*?)(?:\s+#+)?\s*$/;
const FENCE = /^ {0,3}(?:```|~~~)/;
const INDENTED = /^(?: {2,}|\t)/;
/** A bullet starting a line inside a step, which the step's one line leaves out. */
const BULLET = /^\s*(?:[-*+]|\d{1,3}[.)])\s+/;

/** Markdown's marks taken out, so a step reads as words: links keep their words. */
const plain = (text: string) =>
  text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\*\*|__|\*|`/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** A step's words in two: a bold start, or else its first sentence, and the rest. */
const splitStep = (text: string): Step => {
  const bold = /^\*\*(.+?)\*\*\s*[:.\-–—]?\s*(.*)$/.exec(text);
  if (bold) return { title: plain(bold[1] ?? ""), detail: plain(bold[2] ?? "") };
  const sentence = /^(.+?[.!?])\s+(.*)$/.exec(plain(text));
  if (sentence) return { title: sentence[1] ?? "", detail: sentence[2] ?? "" };
  return { title: plain(text), detail: "" };
};

/**
 * The numbered list starting at `start` (its "1."): each item with the lines that carry it on,
 * indented or straight under it, and where the list ends.
 */
const readList = (lines: readonly string[], start: number) => {
  const items: string[][] = [];
  let at = start;
  let blank = false;
  for (; at < lines.length; at++) {
    const line = lines[at] ?? "";
    const item = ITEM.exec(line);
    if (item) {
      items.push([item[2] ?? ""]);
      blank = false;
    } else if (line.trim() === "") {
      blank = true;
    } else if (INDENTED.test(line) || !blank) {
      // Carried on: indented under its item, or the next line of its paragraph.
      items.at(-1)?.push(line.replace(BULLET, ""));
      blank = false;
    } else break;
  }
  return { steps: items.map((item) => splitStep(item.join(" "))), end: at };
};

/** What steps are for, from the line just above them: a few words ending in ":". */
const aboutFrom = (line: string) => {
  const words = plain(line);
  if (!words.endsWith(":")) return undefined;
  const about = words.slice(0, -1).trim();
  return about !== "" && about.split(" ").length <= MOST_ABOUT_WORDS ? about : undefined;
};

/**
 * The steps in an answer (#241): its first numbered list from 1 with at least three lines, outside
 * code, or nothing when it has none. Each step is its first sentence (or the bold words it starts
 * with) and the rest of it, as plain words.
 */
export const stepsIn = (answer: string): Steps | undefined => {
  const lines = answer.split("\n");
  let heading: string | undefined;
  let above = "";
  let inCode = false;
  for (let at = 0; at < lines.length; at++) {
    const line = lines[at] ?? "";
    if (FENCE.test(line)) inCode = !inCode;
    if (inCode || FENCE.test(line)) continue;
    const titled = HEADING.exec(line);
    if (titled) {
      heading = plain(titled[1] ?? "");
      above = "";
      continue;
    }
    if (ITEM.exec(line)?.[1] === "1") {
      const { steps, end } = readList(lines, at);
      if (steps.length >= LEAST_STEPS) return { about: aboutFrom(above) ?? heading, steps };
      at = end - 1;
      above = "";
      continue;
    }
    if (line.trim() !== "") above = line;
  }
  return undefined;
};
