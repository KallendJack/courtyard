import { splitCode } from "./blocks.ts";

/**
 * Maths in answers, as models are told to write it (docs/ai-conduct.md): inline between `\(` and
 * `\)`, centred between `$$` and `$$` on lines of their own. Models also write `\[…\]` and `$$…$$`
 * within a line, so those count too. A single `$` never does, so prices stay text.
 */
const FORMULA = /\$\$(?!\$)[\s\S]+?\$\$|\\\([\s\S]+?\\\)|\\\[[\s\S]+?\\\]/;

/** Whether a block of an answer has a formula in it, outside code. */
export const hasMaths = (block: string) =>
  splitCode(block).some((piece) => !piece.code && FORMULA.test(piece.text));

/** The space a line's list marker or indent takes, so a formula on it stays in its list item. */
const indentOf = (line: string) =>
  " ".repeat(/^\s*(?:(?:[-*+]|\d{1,9}[.)])\s+)?/.exec(line)?.[0].length ?? 0);

/** A centred formula as remark-math reads one: `$$` lines around it, apart from what's around. */
const centred = (formula: string, indent: string) =>
  [
    "",
    "",
    `${indent}$$`,
    ...formula
      .trim()
      .split("\n")
      .map((line) => `${indent}${line.trim()}`),
    `${indent}$$`,
    "",
    "",
  ].join("\n");

/** Rewrites one piece of prose's formulas into the forms remark-math reads. */
const rewrite = (prose: string) =>
  prose
    // `\[…\]` is centred, as its own block.
    .replace(/\\\[([\s\S]+?)\\\]/g, (_, formula: string, at: number, whole: string) =>
      centred(formula, indentOf(whole.slice(whole.lastIndexOf("\n", at - 1) + 1, at))),
    )
    // So is `$$…$$` on a line of its own.
    .replace(
      /^([ \t]*)\$\$(?!\$)((?:(?!\$\$)[^\n])+)\$\$[ \t]*$/gm,
      (_, indent: string, formula: string) => centred(formula, indent),
    )
    // `\(…\)` is inline, which remark-math reads as `$$…$$` within a line.
    .replace(/\\\(([\s\S]+?)\\\)/g, (_, formula: string) => `$$${formula}$$`);

/**
 * A block with its formulas in the forms remark-math reads (it reads only dollars), leaving code
 * as written. Only what's shown changes, never the answer.
 */
export const writeMathsForRemark = (block: string) =>
  splitCode(block)
    .map((piece) => (piece.code ? piece.text : rewrite(piece.text)))
    .join("");
