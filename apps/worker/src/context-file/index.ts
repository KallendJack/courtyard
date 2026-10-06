import type { ContextFile, OwnerContext } from "@courtyard/contract";

type ListSection = "facts" | "plans" | "ideas";
type Section = ListSection | "other";

const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/;
const CONTINUATION = /^\s+\S/;

const listSectionNamed = (heading: string): ListSection | undefined => {
  const word = /^(facts|plans|ideas)\b/i.exec(heading)?.[1]?.toLowerCase();
  return word === "facts" || word === "plans" || word === "ideas" ? word : undefined;
};

/**
 * Adds one line of a section to its list: a list item is one line, a plain line counts as one
 * too, and an indented line carries on the item above it. Says whether the next line can carry
 * this one on.
 */
const addLine = (list: string[], read: { line: string; continuing: boolean }) => {
  const { line, continuing } = read;
  const item = LIST_ITEM.exec(line);
  if (item?.[1] !== undefined) {
    list.push(item[1].trim());
    return true;
  }
  if (line.trim() === "") return false;
  if (continuing && CONTINUATION.test(line) && list.length > 0) {
    list[list.length - 1] = `${list[list.length - 1]} ${line.trim()}`;
    return true;
  }
  list.push(line.trim());
  return true;
};

/**
 * Reads a context file's Markdown into its sections (ADR 0005). A heading at any level that starts
 * with Facts, Plans or Ideas begins that section. Each list item there is one line; a plain line
 * counts as one too, and an indented line carries on the item above it. Text above the first
 * section is the intro, a first-level heading at the top is the title, and any other section is
 * kept as written. Nothing in a context file is an error: missing sections are just empty.
 */
export const parseContextFile = (markdown: string): ContextFile => {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const entries: Record<ListSection, string[]> = { facts: [], plans: [], ideas: [] };
  const intro: string[] = [];
  const other: string[] = [];
  let title: string | undefined;
  let section: Section | undefined;
  let continuing = false;

  for (const line of lines) {
    const heading = HEADING.exec(line);
    const level = heading?.[1]?.length ?? 0;
    const text = heading?.[2];

    if (text !== undefined) {
      const named = listSectionNamed(text);
      if (named) {
        section = named;
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

    continuing = addLine(entries[section], { line, continuing });
  }

  return {
    ...(title === undefined ? {} : { title }),
    intro: intro.join("\n").trim(),
    ...entries,
    other: other.join("\n").trim(),
    characters: markdown.length,
  };
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
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
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

  const answers: string[] = [];
  let continuing = false;
  // Headings (the section's own, and any subheading grouping its lines) aren't lines themselves.
  for (const line of parts.answers) {
    continuing = HEADING.test(line) ? false : addLine(answers, { line, continuing });
  }
  const { facts, plans, ideas } = parseContextFile(parts.aboutMe.join("\n"));

  return {
    ownerContext: {
      intro: parts.intro.join("\n").trim(),
      facts,
      plans,
      ideas,
      answers,
      characters: markdown.length,
    },
    markdown,
    answersMarkdown: answers.length === 0 ? null : parts.answers.join("\n").trim(),
  };
};
