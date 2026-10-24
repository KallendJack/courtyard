/**
 * A shell command's words, read as a POSIX shell reads them: what the worker matches against a
 * code workspace's allowlist (ADR 0007), and what the app summarises a command's activity line
 * from (#285).
 */

/** Why a command can't be read as one command's words. */
export type UnreadableCommand =
  /** It chains, pipes, redirects or substitutes, so it could run something else. */
  | "chained"
  /** Its quotes don't close, or it's empty. */
  | "unreadable";

/** Characters the shell reads as starting another command, a redirect or a substitution. */
const OPERATORS = new Set([";", "&", "|", "<", ">", "(", ")", "`", "$", "\n", "\r"]);
/** Characters a backslash keeps literal inside double quotes. */
const ESCAPED_IN_DOUBLE_QUOTES = new Set(["$", "`", '"', "\\"]);

/**
 * How long the line continuation at a backslash is (#202): the backslash and the line ending after
 * it, which the shell drops, so a command split over lines is one command. 0 when it isn't one.
 */
const continuationAt = (command: string, at: number) => {
  if (command[at + 1] === "\n") return 2;
  return command.startsWith("\r\n", at + 1) ? 3 : 0;
};

/** A character of a word, and whether it was quoted or escaped, so the shell takes it as it is. */
type Char = { readonly char: string; readonly quoted: boolean };

/** The most words a word's braces may expand to before the command can't be read. */
const MOST_WORDS = 256;

/** Characters as a word's, unquoted. */
const plain = (text: string): Char[] => Array.from(text, (char) => ({ char, quoted: false }));

/** A sequence in braces: `1..5`, `a..e`, `10..1..2`. */
const SEQUENCE = /^(?:(-?\d+)\.\.(-?\d+)|([A-Za-z])\.\.([A-Za-z]))(?:\.\.(-?\d+))?$/;

/**
 * What a sequence in braces stands for (`{1..3}` is 1, 2, 3), at most one more than
 * `MOST_WORDS`, or `undefined` when it isn't one. Numbers padded as the shell pads them.
 */
const sequenceOf = (text: string) => {
  const found = SEQUENCE.exec(text);
  if (found === null) return undefined;
  const [, from, to, fromLetter, toLetter, by] = found;
  const letters = fromLetter !== undefined && toLetter !== undefined;
  const start = letters ? fromLetter.charCodeAt(0) : Number(from);
  const stop = letters ? toLetter.charCodeAt(0) : Number(to);
  const step = Math.max(1, Math.abs(Number(by ?? 1))) * (stop < start ? -1 : 1);
  const padded = !letters && [from, to].some((end) => /^-?0\d/.test(end ?? ""));
  const width = padded ? Math.max(from?.length ?? 0, to?.length ?? 0) : 0;
  const each: string[] = [];
  for (let at = start; step > 0 ? at <= stop : at >= stop; at += step) {
    each.push(letters ? String.fromCharCode(at) : String(at).padStart(width, "0"));
    if (each.length > MOST_WORDS) break;
  }
  return each;
};

/**
 * The parts of the braces opening at `open`, as the shell expands them: what's between their
 * unquoted commas (`{a,b}`), or a sequence's (`{1..3}`), and where they close; `undefined` for
 * braces the shell takes as they are (`{}`, `{a}`, one that doesn't close).
 */
const partsIn = (word: readonly Char[], open: number) => {
  let depth = 0;
  const commas: number[] = [];
  for (let at = open + 1; at < word.length; at += 1) {
    const { char, quoted } = word[at] ?? { char: "", quoted: true };
    if (quoted) continue;
    if (char === "{") depth += 1;
    else if (char === "," && depth === 0) commas.push(at);
    else if (char === "}" && depth > 0) depth -= 1;
    else if (char === "}") {
      if (commas.length > 0) {
        const ends = [open, ...commas, at];
        return {
          close: at,
          parts: ends.slice(1).map((end, i) => word.slice((ends[i] ?? 0) + 1, end)),
        };
      }
      const inside = word.slice(open + 1, at);
      const sequence = inside.some((each) => each.quoted)
        ? undefined
        : sequenceOf(inside.map((each) => each.char).join(""));
      return sequence === undefined ? undefined : { close: at, parts: sequence.map(plain) };
    }
  }
  return undefined;
};

/**
 * A word's braces expanded as the shell expands them (#730): `{/etc/passwd,README.md}` is two
 * words, so a path in braces is read as one. `undefined` past `MOST_WORDS`.
 */
const bracesOf = (word: readonly Char[]): (readonly Char[])[] | undefined => {
  for (let open = 0; open < word.length; open += 1) {
    if (word[open]?.char !== "{" || word[open]?.quoted !== false) continue;
    const found = partsIn(word, open);
    if (found === undefined) continue;
    const expanded: (readonly Char[])[] = [];
    for (const part of found.parts) {
      const each = bracesOf([...word.slice(0, open), ...part, ...word.slice(found.close + 1)]);
      if (each === undefined || expanded.length + each.length > MOST_WORDS) return undefined;
      expanded.push(...each);
    }
    return expanded;
  }
  return [word];
};

/**
 * A command's words, as a POSIX shell reads its quotes and backslashes and bash its braces, or
 * why it can't be matched: anything that could make it run more than one command, or substitute
 * something into it, isn't read further. Quoted text may hold line breaks (a pull request's body),
 * and a backslash at a line's end joins the next line on (#202).
 */
export const wordsOf = (
  command: string,
):
  | { readonly ok: true; readonly value: string[] }
  | { readonly ok: false; readonly error: UnreadableCommand } => {
  const words: string[] = [];
  /** The word being read, each character with whether it was quoted or escaped. */
  let word: Char[] | undefined;
  let at = 0;
  const add = (text: string, quoted = true) => {
    word = [...(word ?? []), ...Array.from(text, (char) => ({ char, quoted }))];
  };
  /** Ends the word, its braces expanded as the shell does; false when that makes too many. */
  const end = () => {
    if (word === undefined) return true;
    const expanded = bracesOf(word);
    word = undefined;
    if (expanded === undefined) return false;
    words.push(...expanded.map((each) => each.map(({ char }) => char).join("")));
    return true;
  };
  while (at < command.length) {
    const char = command[at] ?? "";
    if (char === " " || char === "\t") {
      if (!end()) return { ok: false, error: "unreadable" };
      at += 1;
    } else if (OPERATORS.has(char) || (char === "#" && word === undefined)) {
      return { ok: false, error: "chained" };
    } else if (char === "\\") {
      const next = command[at + 1];
      if (next === undefined) return { ok: false, error: "unreadable" };
      const continues = continuationAt(command, at);
      if (continues === 0) add(next);
      at += continues || 2;
    } else if (char === "'") {
      const end = command.indexOf("'", at + 1);
      if (end === -1) return { ok: false, error: "unreadable" };
      add(command.slice(at + 1, end));
      at = end + 1;
    } else if (char === '"') {
      add("");
      at += 1;
      for (;;) {
        const inside = command[at];
        if (inside === undefined) return { ok: false, error: "unreadable" };
        at += 1;
        if (inside === '"') break;
        if (inside === "$" || inside === "`") return { ok: false, error: "chained" };
        const continues = inside === "\\" ? continuationAt(command, at - 1) : 0;
        if (continues > 0) {
          at += continues - 1;
        } else if (inside === "\\" && ESCAPED_IN_DOUBLE_QUOTES.has(command[at] ?? "")) {
          add(command[at] ?? "");
          at += 1;
        } else {
          add(inside);
        }
      }
    } else {
      add(char, false);
      at += 1;
    }
  }
  if (!end()) return { ok: false, error: "unreadable" };
  return words.length === 0 ? { ok: false, error: "unreadable" } : { ok: true, value: words };
};
