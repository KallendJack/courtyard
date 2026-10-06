import {
  CONTEXT_SECTION_NAMES,
  type ContextFile,
  type ContextSection,
  type OwnerContext,
  type PlacedLine,
} from "@courtyard/contract";

type Section = ContextSection | "other";

const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/;
/** A list item's marker and the space after it, which a reworded line keeps. */
const LIST_MARKER = /^\s*(?:[-*+]|\d+[.)])\s+/;
const CONTINUATION = /^\s+\S/;

const SECTIONS = ["facts", "plans", "ideas"] as const satisfies readonly ContextSection[];
const LABEL_LETTERS: Record<ContextSection, string> = { facts: "F", plans: "P", ideas: "I" };

const sectionNamed = (heading: string): ContextSection | undefined => {
  const word = /^(facts|plans|ideas)\b/i.exec(heading)?.[1]?.toLowerCase();
  return word === "facts" || word === "plans" || word === "ideas" ? word : undefined;
};

/** One line of a section, and where it's written: from line `start` up to, not including, `end`. */
type Located = { readonly text: string; readonly start: number; readonly end: number };

/**
 * Adds one line of a section to its list: a list item is one line, a plain line counts as one
 * too, and an indented line carries on the item above it. Says whether the next line can carry
 * this one on.
 */
const addLine = (list: Located[], read: { line: string; index: number; continuing: boolean }) => {
  const { line, index, continuing } = read;
  const item = LIST_ITEM.exec(line);
  if (item?.[1] !== undefined) {
    list.push({ text: item[1].trim(), start: index, end: index + 1 });
    return true;
  }
  if (line.trim() === "") return false;
  const last = list.at(-1);
  if (continuing && CONTINUATION.test(line) && last !== undefined) {
    list[list.length - 1] = { ...last, text: `${last.text} ${line.trim()}`, end: index + 1 };
    return true;
  }
  list.push({ text: line.trim(), start: index, end: index + 1 });
  return true;
};

/** A context file read line by line, with where each section and each of its lines are. */
type Scanned = {
  readonly lines: readonly string[];
  readonly title: string | undefined;
  readonly intro: string;
  readonly other: string;
  readonly sections: Record<ContextSection, { heading: number | undefined; lines: Located[] }>;
};

const splitLines = (markdown: string) => markdown.replace(/\r\n?/g, "\n").split("\n");

const scan = (markdown: string): Scanned => {
  const lines = splitLines(markdown);
  const sections: Scanned["sections"] = {
    facts: { heading: undefined, lines: [] },
    plans: { heading: undefined, lines: [] },
    ideas: { heading: undefined, lines: [] },
  };
  const intro: string[] = [];
  const other: string[] = [];
  let title: string | undefined;
  let section: Section | undefined;
  let continuing = false;

  for (const [index, line] of lines.entries()) {
    const heading = HEADING.exec(line);
    const level = heading?.[1]?.length ?? 0;
    const text = heading?.[2];

    if (text !== undefined) {
      const named = sectionNamed(text);
      if (named) {
        section = named;
        sections[named].heading ??= index;
        continuing = false;
        continue;
      }
      if (section === undefined && level === 1 && title === undefined && intro.join("") === "") {
        title = text;
        continue;
      }
      // A subheading inside Facts, Plans or Ideas only groups lines; it isn't a line itself.
      if (section !== undefined && section !== "other" && level >= 3) {
        continuing = false;
        continue;
      }
      if (section !== undefined) {
        section = "other";
        other.push(line);
        continue;
      }
    }

    if (section === undefined) {
      intro.push(line);
      continue;
    }

    if (section === "other") {
      other.push(line);
      continue;
    }

    continuing = addLine(sections[section].lines, { line, index, continuing });
  }

  return { lines, title, intro: intro.join("\n").trim(), other: other.join("\n").trim(), sections };
};

/**
 * Reads a context file's Markdown into its sections. A heading at any level that starts with
 * Facts, Plans or Ideas begins that section. Each list item there is one line; a plain line counts
 * as one too, and an indented line carries on the item above it. Text above the first section is
 * the intro, a first-level heading at the top is the title, and any other section is kept as
 * written. Nothing in a context file is an error: missing sections are just empty.
 */
export const parseContextFile = (markdown: string): ContextFile => {
  const { title, intro, other, sections } = scan(markdown);
  const texts = (section: ContextSection) => sections[section].lines.map((line) => line.text);
  return {
    ...(title === undefined ? {} : { title }),
    intro,
    facts: texts("facts"),
    plans: texts("plans"),
    ideas: texts("ideas"),
    other,
    characters: markdown.length,
  };
};

/** A line of a context file with its line label: `F1` for the first fact, `P2`, `I3`. */
export type LabelledLine = PlacedLine & { readonly label: string };

const labelled = (scanned: Scanned) =>
  SECTIONS.flatMap((section) =>
    scanned.sections[section].lines.map((line, index) => ({
      section,
      line: line.text,
      label: `${LABEL_LETTERS[section]}${index + 1}`,
      start: line.start,
    })),
  );

/** Each line of a context file with its label, Facts first. */
export const labelledLines = (markdown: string): LabelledLine[] =>
  labelled(scan(markdown)).map(({ section, line, label }) => ({ section, line, label }));

/**
 * The context file as a model reads it, each line with its label in front (`- [F1] …`). Labels
 * are only ever shown, never stored (ADR 0013).
 */
export const withLabels = (markdown: string) => {
  const scanned = scan(markdown);
  const lines = [...scanned.lines];
  for (const { label, start } of labelled(scanned)) {
    const line = lines[start] ?? "";
    const marker = LIST_MARKER.exec(line)?.[0] ?? /^\s*/.exec(line)?.[0] ?? "";
    lines[start] = `${marker}[${label}] ${line.slice(marker.length)}`;
  }
  return lines.join("\n");
};

/** Puts the lines back together with the line endings the file had. */
const joined = (markdown: string, lines: readonly string[]) =>
  lines.join(markdown.includes("\r\n") ? "\r\n" : "\n");

/** Where `placed` is written, exactly as worded, in its section. */
const locate = (scanned: Scanned, placed: PlacedLine) =>
  scanned.sections[placed.section].lines.find((line) => line.text === placed.line);

/** Whether the context file has this line, exactly as worded, in this section. */
export const hasContextLine = (markdown: string, placed: PlacedLine) =>
  locate(scan(markdown), placed) !== undefined;

/**
 * Adds a line as a list item at the end of its section: after its last line, or under its heading
 * when it has none. A file without the section gets it at the end.
 */
export const addContextLine = (markdown: string, placed: PlacedLine) => {
  const scanned = scan(markdown);
  const lines = [...scanned.lines];
  const item = `- ${placed.line}`;
  const { heading, lines: existing } = scanned.sections[placed.section];
  const last = existing.at(-1);
  if (last !== undefined) {
    lines.splice(last.end, 0, item);
  } else if (heading !== undefined) {
    // A blank line between the heading and the item, and between the item and what follows.
    const inserted: string[] = [];
    let at = heading + 1;
    if (lines[at]?.trim() === "") at += 1;
    else inserted.push("");
    inserted.push(item);
    const after = lines[at];
    if (after === undefined || after.trim() !== "") inserted.push("");
    lines.splice(at, 0, ...inserted);
  } else {
    while (lines.length > 0 && lines.at(-1)?.trim() === "") lines.pop();
    lines.push(
      ...(lines.length > 0 ? [""] : []),
      `## ${CONTEXT_SECTION_NAMES[placed.section]}`,
      "",
      item,
      "",
    );
  }
  return joined(markdown, lines);
};

/** Takes a line out of its section, or `undefined` when it isn't there as worded. */
export const removeContextLine = (markdown: string, placed: PlacedLine) => {
  const scanned = scan(markdown);
  const found = locate(scanned, placed);
  if (found === undefined) return undefined;
  const lines = [...scanned.lines];
  lines.splice(found.start, found.end - found.start);
  return joined(markdown, lines);
};

/**
 * Rewords a line where it is, or moves it to the end of another section, or `undefined` when it
 * isn't there as worded.
 */
export const replaceContextLine = (
  markdown: string,
  change: { readonly was: PlacedLine; readonly now: PlacedLine },
) => {
  const { was, now } = change;
  if (was.section !== now.section) {
    const removed = removeContextLine(markdown, was);
    return removed === undefined ? undefined : addContextLine(removed, now);
  }
  const scanned = scan(markdown);
  const found = locate(scanned, was);
  if (found === undefined) return undefined;
  const lines = [...scanned.lines];
  const marker = LIST_MARKER.exec(lines[found.start] ?? "")?.[0] ?? "- ";
  lines.splice(found.start, found.end - found.start, `${marker}${now.line}`);
  return joined(markdown, lines);
};

type OwnerPart = "intro" | "aboutMe" | "answers" | "other";

const ownerPartNamed = (heading: string): OwnerPart => {
  if (/^about me\b/i.test(heading)) return "aboutMe";
  if (/^how to answer me\b/i.test(heading)) return "answers";
  return "other";
};

/** The owner context as read, with the text its two kinds of reader get (ADR 0010). */
export type ReadOwnerContext = {
  readonly ownerContext: OwnerContext;
  /** The whole file as written. */
  readonly markdown: string;
  /** The How to answer me section as written, or `null` when it has no lines. */
  readonly answersMarkdown: string | null;
};

/**
 * Reads the owner context's Markdown. A heading at any level starting About me or How to answer
 * me begins that part; any other first- or second-level heading begins a part that's kept but
 * not read, and deeper ones (Facts, say) stay in the part they're in. About me
 * reads like a context file (Facts, Plans and Ideas under it); How to answer me is one preference
 * per line, by the same line rules. A first-level heading at the top is the title.
 */
export const parseOwnerContext = (markdown: string): ReadOwnerContext => {
  const lines = splitLines(markdown);
  const parts: Record<OwnerPart, string[]> = { intro: [], aboutMe: [], answers: [], other: [] };
  let part: OwnerPart = "intro";
  let titled = false;

  for (const line of lines) {
    const heading = HEADING.exec(line);
    const level = heading?.[1]?.length ?? 0;
    const text = heading?.[2];
    const named = text === undefined ? undefined : ownerPartNamed(text);
    if (named === "aboutMe" || named === "answers") {
      part = named;
    } else if (named === "other" && level <= 2) {
      const atTop = part === "intro" && parts.intro.join("").trim() === "";
      if (level === 1 && atTop && !titled) {
        titled = true;
        continue;
      }
      part = "other";
    }
    parts[part].push(line);
  }

  const answers: Located[] = [];
  let continuing = false;
  // Headings (the section's own, and any subheading grouping its lines) aren't lines themselves.
  for (const [index, line] of parts.answers.entries()) {
    continuing = HEADING.test(line) ? false : addLine(answers, { line, index, continuing });
  }
  const { facts, plans, ideas } = parseContextFile(parts.aboutMe.join("\n"));

  return {
    ownerContext: {
      intro: parts.intro.join("\n").trim(),
      facts,
      plans,
      ideas,
      answers: answers.map((answer) => answer.text),
      characters: markdown.length,
    },
    markdown,
    answersMarkdown: answers.length === 0 ? null : parts.answers.join("\n").trim(),
  };
};
