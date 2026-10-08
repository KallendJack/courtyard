/** A list item's first line. */
const LIST_ITEM = /^ {0,3}([-*+]|\d{1,9}[.)])(\s|$)/;
/** The start of a list item's first line, the rest still to come: "2" before "2. Then…". */
const LIST_ITEM_ARRIVING = /^ {0,3}(\d{1,9}[.)]?|[-*+])$/;
/** A link or footnote definition, which other parts of the answer can point to from anywhere. */
const DEFINITION = /^ {0,3}\[[^\]\n]+\]:/m;

/** A code fence's opening line: three or more backticks or tildes, and perhaps the language. */
type Fence = { readonly mark: string; readonly length: number };

/**
 * The run of backticks or tildes a line starts with, if any, and the rest of the line. Indented
 * too, since answers put code under list items.
 */
const startingMarks = (line: string) => {
  const found = /^\s*(`+|~+)(.*)$/.exec(line);
  const marks = found?.[1];
  return marks === undefined
    ? undefined
    : { mark: marks.charAt(0), length: marks.length, rest: found?.[2] ?? "" };
};

const opensFence = (line: string): Fence | undefined => {
  const marks = startingMarks(line);
  // Backticks after a backtick fence's language make it inline code instead, as in ```npm i```.
  const opens = marks && marks.length >= 3 && !(marks.mark === "`" && marks.rest.includes("`"));
  return opens ? { mark: marks.mark, length: marks.length } : undefined;
};

const closesFence = (line: string, fence: Fence) => {
  const marks = startingMarks(line);
  return (
    marks !== undefined &&
    marks.mark === fence.mark &&
    marks.length >= fence.length &&
    marks.rest.trim() === ""
  );
};

/** Whether a line is only the start of a fence's marks, the rest still to come. */
const fenceArriving = (line: string, open: Fence | undefined) => {
  const marks = startingMarks(line);
  return (
    marks !== undefined &&
    marks.rest === "" &&
    marks.length < (open?.length ?? 3) &&
    (open === undefined || marks.mark === open.mark)
  );
};

/**
 * An answer's markdown split into blocks (paragraphs, lists, code, tables), each formatted on its
 * own, so while an answer streams only the last one changes. It splits only at blank lines that
 * end what came before: never inside code, a list, or anything indented under it, and not at all
 * when there's a link or footnote definition, which the whole answer can point to.
 */
export const splitBlocks = (text: string): string[] => {
  if (DEFINITION.test(text)) return [text];
  const blocks: string[] = [];
  let block: string[] = [];
  let blanks = 0;
  let fence: Fence | undefined;
  const lines = text.split("\n");
  lines.forEach((line, index) => {
    if (fence) {
      block.push(line);
      if (closesFence(line, fence)) fence = undefined;
      return;
    }
    if (line.trim() === "") {
      if (block.length > 0) blanks += 1;
      return;
    }
    if (blanks > 0) {
      const listItem =
        LIST_ITEM.test(line) || (index === lines.length - 1 && LIST_ITEM_ARRIVING.test(line));
      const carriesOn =
        /^\s/.test(line) || (listItem && block.some((earlier) => LIST_ITEM.test(earlier)));
      if (carriesOn) block.push(...Array.from({ length: blanks }, () => ""));
      else {
        blocks.push(block.join("\n"));
        block = [];
      }
      blanks = 0;
    }
    block.push(line);
    fence = opensFence(line);
  });
  if (block.length > 0) blocks.push(block.join("\n"));
  return blocks;
};

/** Marks that open formatting the rest of the line closes, longest first. */
const EMPHASIS = ["**", "__", "~~", "*", "_"] as const;

/** Whether the `*` at `at` is a list item's bullet. */
const isBullet = (text: string, at: number) =>
  /^ {0,3}$/.test(text.slice(text.lastIndexOf("\n", at - 1) + 1, at)) &&
  text.charAt(at + 1) === " ";

/** Where each copy of `mark` is in `text`, leaving out list bullets. */
const marksIn = (text: string, mark: (typeof EMPHASIS)[number]) => {
  const pattern = new RegExp(`\\${mark.charAt(0)}{${mark.length}}`, "g");
  return [...text.matchAll(pattern)]
    .map((match) => match.index)
    .filter((at) => mark !== "*" || !isBullet(text, at));
};

/**
 * The last block of a streaming answer, made whole for showing: a code fence still being written
 * is closed, and so are bold, italics, struck-through text and inline code, so they show formatted
 * rather than as marks that change once the rest arrives. A mark with nothing after it yet, or a
 * link whose address hasn't all arrived, is left out until it has. Only what's shown changes,
 * never the answer.
 */
export const finishForNow = (block: string): string => {
  const lines = block.split("\n");
  const last = lines.pop() ?? "";
  // Whether a fence is still open by the last line, and where the last line's paragraph starts.
  let fence: Fence | undefined;
  let paragraphStart = 0;
  lines.forEach((line, index) => {
    const closed = fence !== undefined && closesFence(line, fence);
    if (fence === undefined) fence = opensFence(line);
    else if (closed) fence = undefined;
    if (fence === undefined && (closed || line.trim() === "")) paragraphStart = index + 1;
  });

  if (fence) {
    if (closesFence(last, fence)) return block;
    const closing = fence.mark.repeat(fence.length);
    return [...lines, ...(fenceArriving(last, fence) ? [] : [last]), closing].join("\n");
  }
  if (fenceArriving(last, undefined)) return lines.join("\n");
  if (opensFence(last)) return block;

  const earlier = lines.slice(0, paragraphStart);
  let tail = [...lines.slice(paragraphStart), last]
    .join("\n")
    .replace(/!?\[([^\]\n]*)\]\([^)\s]*$/, "$1");
  let closers = "";

  // Escaped marks (\*) are text, so they're left out of the counts; positions stay the same.
  const plain = tail.replace(/\\./g, "  ");
  const ticks = [...plain.matchAll(/(?<!`)`(?!`)/g)].map((match) => match.index);
  const openTick = ticks.length % 2 === 1 ? ticks.at(-1) : undefined;
  if (openTick !== undefined) {
    if (openTick === tail.length - 1) tail = tail.slice(0, -1);
    else closers = "`";
  }

  // Inline code is shown as it's written, so marks inside it don't count.
  const outsideCode = (openTick === undefined ? plain : plain.slice(0, openTick)).replace(
    /`[^`]*`/g,
    (code) => " ".repeat(code.length),
  );
  const open: { mark: string; at: number }[] = [];
  for (const mark of EMPHASIS) {
    // A lone mark is never half of a double one.
    const counted = mark.length === 1 ? outsideCode.replaceAll(mark.repeat(2), "  ") : outsideCode;
    const found = marksIn(counted, mark);
    const at = found.length % 2 === 1 ? found.at(-1) : undefined;
    if (at === undefined) continue;
    // Only a mark that can start formatting is closed: after a space or punctuation and before
    // text, so "5*3" or "snake_case" stays as it is.
    const startsFormatting =
      (at === 0 || /[\s\p{P}\p{S}]/u.test(tail.charAt(at - 1))) &&
      /\S/.test(tail.charAt(at + mark.length));
    if (at + mark.length === tail.length) tail = tail.slice(0, at);
    else if (startsFormatting) open.push({ mark, at });
  }
  if (open.length > 0 && closers === "") tail = tail.trimEnd();
  closers += open
    .sort((a, b) => b.at - a.at)
    .map((opened) => opened.mark)
    .join("");

  return [...earlier, tail + closers].join("\n");
};
