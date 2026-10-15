/** One part of a pull request's description: its heading, and its Markdown under it. */
export type DescriptionPart = { heading: string; text: string };

/**
 * A pull request's description, as the house's PR skill writes it (#240): its Summary, then any
 * other parts, with Evidence and Merge Danger apart, to show side by side.
 */
export type Description = {
  /** The Summary, or what comes before the first heading when there's no Summary. */
  summary: string;
  /** Its first line, as plain words: what changed, in one line. */
  firstLine: string;
  others: DescriptionPart[];
  evidence: string | undefined;
  danger: string | undefined;
};

const HEADING = /^#{1,3}\s+(.+?)\s*#*\s*$/;
/** Lines for GitHub rather than the owner: an issue it closes, and who made it. */
const PLUMBING = /^\s*(?:(?:closes|fixes|resolves|refs|part of)\s+#\d+|🤖 generated with\b)/i;
const FENCE = /^\s*(```|~~~)/;

/** Markdown's marks taken out of a line, leaving its words: links' text, code, emphasis. */
const plain = (line: string) =>
  line
    .replace(/^\s*(?:[-*+]|\d+[.)]|>)\s+/, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/(\*\*|__|\*|_|~~)(\S(?:.*?\S)?)\1/g, "$2")
    .trim();

/** The first line of Markdown that is words, as plain words: not a heading, a fence or a rule. */
const firstLineOf = (text: string) => {
  let fenced = false;
  for (const line of text.split("\n")) {
    if (FENCE.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced || HEADING.test(line) || /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) continue;
    const words = plain(line);
    if (words !== "") return words;
  }
  return "";
};

/**
 * Reads a pull request's description into its parts, by its headings (any level up to `###` that
 * isn't inside a fence), leaving out the lines that are for GitHub.
 */
export const readDescription = (body: string): Description => {
  const parts: DescriptionPart[] = [];
  let current: DescriptionPart = { heading: "", text: "" };
  let fenced = false;
  for (const line of body.replaceAll("\r\n", "\n").split("\n")) {
    if (FENCE.test(line)) fenced = !fenced;
    const heading = fenced ? null : HEADING.exec(line);
    if (heading?.[1] !== undefined) {
      parts.push(current);
      current = { heading: heading[1], text: "" };
      continue;
    }
    if (!fenced && PLUMBING.test(line)) continue;
    current.text += `${line}\n`;
  }
  parts.push(current);
  const named = (name: string) =>
    parts.find((part) => part.heading.toLowerCase() === name)?.text.trim();
  const lead = parts[0]?.text.trim() ?? "";
  const summary = named("summary") ?? lead;
  const set = new Set(["summary", "evidence", "merge danger"]);
  const others = parts
    .slice(1)
    .filter((part) => !set.has(part.heading.toLowerCase()) && part.text.trim() !== "")
    .map((part) => ({ heading: part.heading, text: part.text.trim() }));
  // Words before the first heading, when there is a Summary as well, come first among the others.
  if (named("summary") !== undefined && lead !== "") others.unshift({ heading: "", text: lead });
  return {
    summary,
    firstLine: firstLineOf(summary),
    others,
    evidence: named("evidence") || undefined,
    danger: named("merge danger") || undefined,
  };
};
