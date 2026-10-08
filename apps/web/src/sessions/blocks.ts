/** A code fence: three or more backticks or tildes, then perhaps the code's language. */
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
/** The start of a fence, on a line of its own while the rest of it hasn't arrived. */
const PART_OF_A_FENCE = /^ {0,3}(`{1,2}|~{1,2})$/;
/** A list item's first line. */
const LIST_ITEM = /^ {0,3}([-*+]|\d{1,9}[.)])(\s|$)/;
/** A link or footnote definition, which other parts of the answer can point to from anywhere. */
const DEFINITION = /^ {0,3}\[[^\]\n]+\]:/m;

type Fence = { readonly mark: string; readonly length: number };

const opensFence = (line: string): Fence | undefined => {
  const marks = FENCE.exec(line)?.[1];
  return marks === undefined ? undefined : { mark: marks.charAt(0), length: marks.length };
};

const closesFence = (line: string, fence: Fence) => {
  const marks = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line)?.[1];
  return marks !== undefined && marks.charAt(0) === fence.mark && marks.length >= fence.length;
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
  for (const line of text.split("\n")) {
    if (fence) {
      block.push(line);
      if (closesFence(line, fence)) fence = undefined;
      continue;
    }
    if (line.trim() === "") {
      if (block.length > 0) blanks += 1;
      continue;
    }
    if (blanks > 0) {
      const carriesOn =
        /^\s/.test(line) ||
        (LIST_ITEM.test(line) && block.some((before) => LIST_ITEM.test(before)));
      if (carriesOn) block.push(...Array.from({ length: blanks }, () => ""));
      else {
        blocks.push(block.join("\n"));
        block = [];
      }
      blanks = 0;
    }
    block.push(line);
    fence = opensFence(line);
  }
  if (block.length > 0) blocks.push(block.join("\n"));
  return blocks;
};

/** Marks that open formatting the rest of the line closes, longest first. */
const EMPHASIS = ["**", "__", "~~", "*"] as const;

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
  let since = 0;
  lines.forEach((line, index) => {
    if (fence) {
      if (closesFence(line, fence)) fence = undefined;
    } else fence = opensFence(line);
    if (fence === undefined && (line.trim() === "" || FENCE.test(line))) since = index + 1;
  });

  if (fence) {
    const closing = fence.mark.repeat(fence.length);
    if (closesFence(last, fence)) return block;
    const partial = new RegExp(`^ {0,3}\\${fence.mark}{1,${fence.length - 1}}$`).test(last);
    return [...lines, ...(partial ? [] : [last]), closing].join("\n");
  }
  if (PART_OF_A_FENCE.test(last)) return lines.join("\n");
  if (opensFence(last)) return block;

  const before = lines.slice(0, since);
  let tail = [...lines.slice(since), last].join("\n").replace(/!?\[([^\]\n]*)\]\([^)\s]*$/, "$1");
  let closers = "";

  const ticks = [...tail.matchAll(/(?<!`)`(?!`)/g)].map((match) => match.index);
  const openTick = ticks.length % 2 === 1 ? ticks.at(-1) : undefined;
  if (openTick !== undefined) {
    if (openTick === tail.length - 1) tail = tail.slice(0, -1);
    else closers = "`";
  }

  // Inline code is shown as it's written, so marks inside it don't count.
  const outsideCode = (openTick === undefined ? tail : tail.slice(0, openTick)).replace(
    /`[^`]*`/g,
    (code) => " ".repeat(code.length),
  );
  const open: { mark: string; at: number }[] = [];
  for (const mark of EMPHASIS) {
    const found = marksIn(mark === "*" ? outsideCode.replaceAll("**", "  ") : outsideCode, mark);
    const at = found.length % 2 === 1 ? found.at(-1) : undefined;
    if (at === undefined) continue;
    if (at + mark.length === tail.length) tail = tail.slice(0, at);
    else if (/\S/.test(tail.charAt(at + mark.length))) open.push({ mark, at });
  }
  if (open.length > 0 && closers === "") tail = tail.trimEnd();
  closers += open
    .sort((a, b) => b.at - a.at)
    .map((opened) => opened.mark)
    .join("");

  return [...before, tail + closers].join("\n");
};
