import {
  CONTEXT_SECTION_NAMES,
  type ContextFile,
  ContextSection,
  type OwnerContext,
  OwnerSection,
  type PlacedLine,
} from "@courtyard/contract";

type Section = ContextSection | "other";

const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/;
/** A list item's marker and the space after it, which a reworded line keeps. */
const LIST_MARKER = /^\s*(?:[-*+]|\d+[.)])\s+/;
const CONTINUATION = /^\s+\S/;

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

/** Where one section's lines are written in a file: its heading's line, when it has one, and its lines. */
type SectionAt = Scanned["sections"][ContextSection];

/** A file read for the lines it holds: its lines, where each section is, and how to add one it lacks. */
type Layout<S extends string> = {
  readonly lines: readonly string[];
  readonly sections: Record<S, SectionAt>;
  /** The file's lines with `section` added, holding just `item`. */
  readonly withMissing: (section: S, item: string) => string[];
};

/** The lines with a section added at the end, after one blank line. */
const appended = (lines: readonly string[], section: readonly string[]) => {
  const out = [...lines];
  while (out.length > 0 && out.at(-1)?.trim() === "") out.pop();
  out.push(...(out.length > 0 ? [""] : []), ...section, "");
  return out;
};

/** The lines with `block` put in at `at`, with a blank line either side of it. */
const inserted = (lines: readonly string[], at: number, block: readonly string[]) => {
  const out = [...lines];
  const before = at > 0 && out[at - 1]?.trim() !== "" ? [""] : [];
  const next = out[at];
  const after = next === undefined || next.trim() !== "" ? [""] : [];
  out.splice(at, 0, ...before, ...block, ...after);
  return out;
};

const workspaceLayout = (markdown: string): Layout<ContextSection> => {
  const { lines, sections } = scan(markdown);
  return {
    lines,
    sections,
    withMissing: (section, item) =>
      appended(lines, [`## ${CONTEXT_SECTION_NAMES[section]}`, "", item]),
  };
};

type OwnerPart = "intro" | "aboutMe" | "answers" | "other";

const ownerPartNamed = (heading: string): OwnerPart => {
  if (/^about me\b/i.test(heading)) return "aboutMe";
  if (/^how to answer me\b/i.test(heading)) return "answers";
  return "other";
};

/**
 * The owner context read line by line: which part each line is in (the title is in none), and
 * where each section is. A heading at any level starting About me or How to answer me begins that
 * part; any other first- or second-level heading begins a part that's kept but not read, and
 * deeper ones (Facts, say) stay in the part they're in.
 */
const scanOwner = (markdown: string) => {
  const lines = splitLines(markdown);
  const parts: (OwnerPart | undefined)[] = [];
  let part: OwnerPart = "intro";
  let titled = false;
  for (const [index, line] of lines.entries()) {
    const heading = HEADING.exec(line);
    const level = heading?.[1]?.length ?? 0;
    const text = heading?.[2];
    const named = text === undefined ? undefined : ownerPartNamed(text);
    if (named === "aboutMe" || named === "answers") {
      part = named;
    } else if (named === "other" && level <= 2) {
      const atTop = part === "intro" && lines.slice(0, index).every((above) => above.trim() === "");
      if (level === 1 && atTop && !titled) {
        titled = true;
        parts.push(undefined);
        continue;
      }
      part = "other";
    }
    parts.push(part);
  }

  /** The lines of one part where they are, with every other line blank. */
  const only = (wanted: OwnerPart) =>
    lines.map((line, index) => (parts[index] === wanted ? line : ""));

  // About me reads like a context file: Facts, Plans and Ideas under it.
  const { facts, plans, ideas } = scan(only("aboutMe").join("\n")).sections;
  // How to answer me is one preference per line. Headings (the section's own, and any subheading
  // grouping its lines) aren't lines themselves.
  const answers: SectionAt = { heading: undefined, lines: [] };
  let continuing = false;
  for (const [index, line] of only("answers").entries()) {
    if (HEADING.test(line)) {
      answers.heading ??= index;
      continuing = false;
    } else {
      continuing = addLine(answers.lines, { line, index, continuing });
    }
  }

  const sections: Record<OwnerSection, SectionAt> = { facts, plans, ideas, answers };
  return { lines, parts, only, sections };
};

const ownerLayout = (markdown: string): Layout<OwnerSection> => {
  const { lines, parts, sections } = scanOwner(markdown);
  return {
    lines,
    sections,
    withMissing: (section, item) => {
      if (section === "answers") return appended(lines, ["## How to answer me", "", item]);
      const heading = `### ${CONTEXT_SECTION_NAMES[section]}`;
      // After About me's last written line, or in a new About me at the end.
      const last = lines.findLastIndex(
        (line, index) => parts[index] === "aboutMe" && line.trim() !== "",
      );
      return last === -1
        ? appended(lines, ["## About me", "", heading, "", item])
        : inserted(lines, last + 1, [heading, "", item]);
    },
  };
};

/** One section of a file, ready to change: the file's lines, the section, and how to add it. */
type Found = {
  readonly lines: readonly string[];
  readonly at: SectionAt;
  readonly withMissing: (item: string) => string[];
};

const foundIn = <S extends string>(layout: Layout<S>, section: S): Found => ({
  lines: layout.lines,
  at: layout.sections[section],
  withMissing: (item) => layout.withMissing(section, item),
});

/** The section a placed line belongs in, in the file it's placed in. */
const find = (markdown: string, placed: PlacedLine): Found =>
  placed.place === "workspace"
    ? foundIn(workspaceLayout(markdown), placed.section)
    : foundIn(ownerLayout(markdown), placed.section);

/** A line with its place and its line label: `F1` for the workspace's first fact, `MF1`, `A2`. */
export type LabelledLine = PlacedLine & { readonly label: string };

const WORKSPACE_LABELS: Record<ContextSection, string> = { facts: "F", plans: "P", ideas: "I" };
/** The owner context's labels, which can't clash with a workspace's (ADR 0013). */
const OWNER_LABELS: Record<OwnerSection, string> = {
  facts: "MF",
  plans: "MP",
  ideas: "MI",
  answers: "A",
};

/** A section's lines with their labels and where each starts. */
const labelsIn = (at: SectionAt, letters: string) =>
  at.lines.map((line, index) => ({
    line: line.text,
    label: `${letters}${index + 1}`,
    start: line.start,
  }));

/** Each line of a file with its label, place and section, and where it starts, in label order. */
const labelled = (markdown: string, place: PlacedLine["place"]) => {
  if (place === "workspace") {
    const { sections } = workspaceLayout(markdown);
    return ContextSection.options.flatMap((section) =>
      labelsIn(sections[section], WORKSPACE_LABELS[section]).map((line) => ({
        ...line,
        place,
        section,
      })),
    );
  }
  const { sections } = ownerLayout(markdown);
  return OwnerSection.options.flatMap((section) =>
    labelsIn(sections[section], OWNER_LABELS[section]).map((line) => ({
      ...line,
      place,
      section,
    })),
  );
};

/** Each line of a workspace's context file or the owner context with its label, Facts first. */
export const labelledLines = (markdown: string, place: PlacedLine["place"]): LabelledLine[] =>
  labelled(markdown, place).map(({ start: _, ...line }) => line);

/** The file's lines, each line with its label put in front (`- [F1] …`). */
const labelledText = (markdown: string, place: PlacedLine["place"]) => {
  const lines = splitLines(markdown);
  for (const { label, start } of labelled(markdown, place)) {
    const line = lines[start] ?? "";
    const marker = LIST_MARKER.exec(line)?.[0] ?? /^\s*/.exec(line)?.[0] ?? "";
    lines[start] = `${marker}[${label}] ${line.slice(marker.length)}`;
  }
  return lines;
};

/**
 * A context file or the owner context as a model reads it, each line with its label in front
 * (`- [F1] …`). Labels are only ever shown, never stored (ADR 0013).
 */
export const withLabels = (markdown: string, place: PlacedLine["place"]) =>
  labelledText(markdown, place).join("\n");

/**
 * The owner context's How to answer me with its labels, as a code workspace's models read it, or
 * `null` when it has no lines.
 */
export const answersWithLabels = (markdown: string): string | null => {
  const { parts, sections } = scanOwner(markdown);
  if (sections.answers.lines.length === 0) return null;
  return labelledText(markdown, "owner")
    .filter((_, index) => parts[index] === "answers")
    .join("\n")
    .trim();
};

/** Puts the lines back together with the line endings the file had. */
const joined = (markdown: string, lines: readonly string[]) =>
  lines.join(markdown.includes("\r\n") ? "\r\n" : "\n");

/** Where `placed` is written, exactly as worded, in its section. */
const locate = (found: Found, placed: PlacedLine) =>
  found.at.lines.find((line) => line.text === placed.line);

/** Whether the file has this line, exactly as worded, in this section. */
export const hasContextLine = (markdown: string, placed: PlacedLine) =>
  locate(find(markdown, placed), placed) !== undefined;

/**
 * Adds a line as a list item at the end of its section: after its last line, or under its heading
 * when it has none. A file without the section gets it.
 */
export const addContextLine = (markdown: string, placed: PlacedLine) => {
  const found = find(markdown, placed);
  const item = `- ${placed.line}`;
  const { heading, lines: existing } = found.at;
  const last = existing.at(-1);
  if (last !== undefined) {
    const lines = [...found.lines];
    lines.splice(last.end, 0, item);
    return joined(markdown, lines);
  }
  if (heading === undefined) return joined(markdown, found.withMissing(item));
  // Under the heading, past the blank line after it.
  const at = found.lines[heading + 1]?.trim() === "" ? heading + 2 : heading + 1;
  return joined(markdown, inserted(found.lines, at, [item]));
};

/** Takes a line out of its section, or `undefined` when it isn't there as worded. */
export const removeContextLine = (markdown: string, placed: PlacedLine) => {
  const found = find(markdown, placed);
  const line = locate(found, placed);
  if (line === undefined) return undefined;
  const lines = [...found.lines];
  lines.splice(line.start, line.end - line.start);
  return joined(markdown, lines);
};

/**
 * Rewords a line where it is, or moves it to the end of another section of the same file, or
 * `undefined` when it isn't there as worded. Moving a line to the other file is the caller's:
 * take it out of one and add it to the other.
 */
export const replaceContextLine = (
  markdown: string,
  change: { readonly was: PlacedLine; readonly now: PlacedLine },
) => {
  const { was, now } = change;
  if (was.place !== now.place) return undefined;
  if (was.section !== now.section) {
    const removed = removeContextLine(markdown, was);
    return removed === undefined ? undefined : addContextLine(removed, now);
  }
  const found = find(markdown, was);
  const line = locate(found, was);
  if (line === undefined) return undefined;
  const lines = [...found.lines];
  const marker = LIST_MARKER.exec(lines[line.start] ?? "")?.[0] ?? "- ";
  lines.splice(line.start, line.end - line.start, `${marker}${now.line}`);
  return joined(markdown, lines);
};

/** The owner context as read (ADR 0010). */
export type ReadOwnerContext = {
  readonly ownerContext: OwnerContext;
  /** The whole file as written. */
  readonly markdown: string;
};

/**
 * Reads the owner context's Markdown (see `scanOwner` for its parts). About me reads like a
 * context file (Facts, Plans and Ideas under it); How to answer me is one preference per line, by
 * the same line rules. A first-level heading at the top is the title.
 */
export const parseOwnerContext = (markdown: string): ReadOwnerContext => {
  const { only, sections } = scanOwner(markdown);
  const texts = (section: OwnerSection) => sections[section].lines.map((line) => line.text);
  return {
    ownerContext: {
      intro: only("intro").join("\n").trim(),
      facts: texts("facts"),
      plans: texts("plans"),
      ideas: texts("ideas"),
      answers: texts("answers"),
      characters: markdown.length,
    },
    markdown,
  };
};
