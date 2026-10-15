/**
 * What main's build reads of a GitHub Actions workflow file (#337): its jobs in order, each with
 * its name, the jobs it `needs:`, and whether it runs as a matrix. Only that much of the YAML is
 * read, in the block style workflows are written in: a job's `needs:` as one id, a `[a, b]` list or
 * a `- a` list; anything else in the file is passed over.
 */

/** A job in a workflow, as main's build draws it. */
export type WorkflowJob = {
  /** Its key under `jobs:`, which other jobs' `needs:` name. */
  readonly id: string;
  /** Its `name:`, expressions and all ("E2E ${{ matrix.shard }}/4"); `null` when it has none. */
  readonly name: string | null;
  readonly needs: readonly string[];
  /** It has a `strategy.matrix`, so it runs once for each of the matrix's values. */
  readonly matrix: boolean;
};

type Line = { readonly indent: number; readonly text: string };

/** A value as YAML writes a plain scalar: without its quotes. */
const unquoted = (value: string) => {
  const trimmed = value.trim();
  const quote = trimmed[0];
  return (quote === '"' || quote === "'") && trimmed.endsWith(quote) && trimmed.length > 1
    ? trimmed.slice(1, -1)
    : trimmed;
};

/** A line without its comment: a `#` at its start or after a space, outside quotes. */
const withoutComment = (text: string) => {
  let quote: string | undefined;
  for (let at = 0; at < text.length; at += 1) {
    const char = text[at];
    if (quote !== undefined) {
      if (char === quote) quote = undefined;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === "#" && (at === 0 || text[at - 1] === " ")) {
      return text.slice(0, at);
    }
  }
  return text;
};

/** The file's lines that hold something, each with how far it's indented. */
const linesOf = (text: string): readonly Line[] =>
  text.split(/\r?\n/).flatMap((raw) => {
    const line = withoutComment(raw).trimEnd();
    const content = line.trimStart();
    return content === "" ? [] : [{ indent: line.length - content.length, text: content }];
  });

/** `key: value` on one line, as its key and what follows the colon. */
const KEY = /^([A-Za-z0-9_-]+|"[^"]*"|'[^']*'):(?:\s+(.*))?$/;
const keyOf = (text: string) => {
  const found = KEY.exec(text);
  return found?.[1] === undefined
    ? undefined
    : { key: unquoted(found[1]), value: (found[2] ?? "").trim() };
};

/** A `needs:` written on its line: one id, or a `[a, b]` list. */
const listOf = (value: string) =>
  value.startsWith("[") && value.endsWith("]")
    ? value
        .slice(1, -1)
        .split(",")
        .map(unquoted)
        .filter((id) => id !== "")
    : [unquoted(value)];

/** The lines indented further than `indent`, from `from` on: a key's block. */
const blockAfter = (lines: readonly Line[], from: number, indent: number) => {
  let end = from;
  while (end < lines.length && (lines[end]?.indent ?? 0) > indent) end += 1;
  return lines.slice(from, end);
};

/** One job, from the lines of its block. */
const jobOf = (id: string, block: readonly Line[]): WorkflowJob => {
  const indent = block[0]?.indent;
  let name: string | null = null;
  let needs: readonly string[] = [];
  let matrix = false;
  block.forEach((line, at) => {
    if (line.indent !== indent) return;
    const found = keyOf(line.text);
    if (found === undefined) return;
    const inside = blockAfter(block, at + 1, line.indent);
    switch (found.key) {
      case "name":
        name = unquoted(found.value);
        break;
      case "needs":
        needs =
          found.value === ""
            ? inside
                .filter((each) => each.text.startsWith("- "))
                .map((each) => unquoted(each.text.slice(2)))
            : listOf(found.value);
        break;
      case "strategy":
        matrix = inside.some((each) => keyOf(each.text)?.key === "matrix");
        break;
    }
  });
  return { id, name, needs, matrix };
};

/** The jobs in a workflow file, in the order it lists them; none when it lists none. */
export const workflowJobs = (text: string): readonly WorkflowJob[] => {
  const lines = linesOf(text);
  const at = lines.findIndex((line) => line.indent === 0 && keyOf(line.text)?.key === "jobs");
  if (at === -1) return [];
  const block = blockAfter(lines, at + 1, 0);
  const indent = block[0]?.indent;
  return block.flatMap((line, index) => {
    if (line.indent !== indent) return [];
    const found = keyOf(line.text);
    if (found === undefined || found.value !== "") return [];
    return [jobOf(found.key, blockAfter(block, index + 1, line.indent))];
  });
};
