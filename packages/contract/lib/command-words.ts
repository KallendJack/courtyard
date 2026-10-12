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

/**
 * A command's words, as a POSIX shell reads its quotes and backslashes, or why it can't be
 * matched: anything that could make it run more than one command, or substitute something into
 * it, isn't read further. Quoted text may hold line breaks (a pull request's body), and a
 * backslash at a line's end joins the next line on (#202).
 */
export const wordsOf = (
  command: string,
):
  | { readonly ok: true; readonly value: string[] }
  | { readonly ok: false; readonly error: UnreadableCommand } => {
  const words: string[] = [];
  let word: string | undefined;
  let at = 0;
  const add = (text: string) => {
    word = (word ?? "") + text;
  };
  while (at < command.length) {
    const char = command[at] ?? "";
    if (char === " " || char === "\t") {
      if (word !== undefined) words.push(word);
      word = undefined;
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
      add(char);
      at += 1;
    }
  }
  if (word !== undefined) words.push(word);
  return words.length === 0 ? { ok: false, error: "unreadable" } : { ok: true, value: words };
};
