import type { ContextFile } from "@courtyard/contract";

type Section = "facts" | "plans" | "ideas" | "other";

const TITLE = /^#\s+(.+?)\s*#*\s*$/;
const SECTION_HEADING = /^##\s+(.+?)\s*#*\s*$/;
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/;
const CONTINUATION = /^\s+\S/;

const sectionNamed = (heading: string): Section => {
  const word = /^(facts|plans|ideas)\b/i.exec(heading)?.[1]?.toLowerCase();
  return word === "facts" || word === "plans" || word === "ideas" ? word : "other";
};

/**
 * Reads a context file's Markdown into its sections (ADR 0005). Each list item under Facts, Plans
 * or Ideas is one line; a plain line there counts as one too, and an indented line carries on the
 * item above it. Text above the first section is the intro, and any other section is kept as
 * written. Nothing in a context file is an error: missing sections are just empty.
 */
export const parseContextFile = (markdown: string): ContextFile => {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const entries: Record<"facts" | "plans" | "ideas", string[]> = {
    facts: [],
    plans: [],
    ideas: [],
  };
  const intro: string[] = [];
  const other: string[] = [];
  let title: string | undefined;
  let section: Section | undefined;
  let continuing = false;

  for (const line of lines) {
    const heading = SECTION_HEADING.exec(line);
    if (heading?.[1]) {
      section = sectionNamed(heading[1]);
      if (section === "other") other.push(line);
      continuing = false;
      continue;
    }

    if (section === undefined) {
      const titleLine = TITLE.exec(line);
      if (titleLine?.[1] && title === undefined && intro.every((l) => l.trim() === "")) {
        title = titleLine[1];
      } else {
        intro.push(line);
      }
      continue;
    }

    if (section === "other") {
      other.push(line);
      continue;
    }

    const list = entries[section];
    const item = LIST_ITEM.exec(line);
    if (item?.[1] !== undefined) {
      list.push(item[1].trim());
      continuing = true;
    } else if (line.trim() === "") {
      continuing = false;
    } else if (continuing && CONTINUATION.test(line) && list.length > 0) {
      list[list.length - 1] = `${list[list.length - 1]} ${line.trim()}`;
    } else {
      list.push(line.trim());
      continuing = true;
    }
  }

  return {
    ...(title === undefined ? {} : { title }),
    intro: intro.join("\n").trim(),
    ...entries,
    other: other.join("\n").trim(),
  };
};
