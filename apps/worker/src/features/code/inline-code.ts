import { dirname, isAbsolute, resolve } from "node:path";
import { readJavaScript } from "./javascript.ts";
import { outside, pathsIn } from "./paths.ts";

/**
 * Code given on the line (`node -e`, `python -c`, #464), read by its text: the paths it names,
 * and whether it could run another program or reach the network, so routine code (#730) and
 * Allow all (#428) never cover that. JavaScript is read with a parser (`readJavaScript`, #747),
 * other code by its words. A check of what the code says, not of what it does: it catches a model's
 * mistakes, never code written to slip past it, and a script the session writes and runs is its
 * own code either way (ADR 0038).
 */

/** Programs that run code given on the line, by the options that give it (`python -c`, #428). */
const INLINE_CODE = new Map<string, readonly string[]>([
  ["node", ["-e", "--eval", "-p", "--print"]],
  ["python", ["-c"]],
  ["python3", ["-c"]],
  ["py", ["-c"]],
  ["perl", ["-e", "-E"]],
  ["ruby", ["-e"]],
  ["php", ["-r"]],
  ["deno", ["eval"]],
  ["bun", ["-e", "--eval", "-p", "--print"]],
]);

/** Whether a word is one of a program's options that give code on the line: `-e`, `--eval=…`. */
export const givesCode = (program: string, word: string) =>
  INLINE_CODE.get(program)?.some(
    (option) => word === option || (option.startsWith("--") && word.startsWith(`${option}=`)),
  ) === true;

/**
 * The text of code given on the line (#464), with the words around it but not the options that
 * give it (`--eval=`), or `undefined` for none.
 */
export const codeOf = (words: readonly string[]) => {
  const [program] = words;
  if (program === undefined || !words.some((word) => givesCode(program, word))) return undefined;
  return words
    .slice(1)
    .flatMap((word) => {
      if (!givesCode(program, word)) return [word];
      return word.includes("=") ? [word.slice(word.indexOf("=") + 1)] : [];
    })
    .join(" ");
};

/**
 * The words in code, split where code separates them (spaces, quotes, escapes, brackets,
 * operators), so a path in it is read as one: `/etc/hosts` of `open('/etc/hosts')`.
 */
const wordsIn = (code: string) => code.split(/[\s'"`(){}[\],;+*<>|&!?%^@#$\\]+/);

/** The words in code given on the line (#464), or `undefined` for a command that gives none. */
export const codeWordsOf = (words: readonly string[]) => {
  const code = codeOf(words);
  return code === undefined ? undefined : wordsIn(code);
};

/** The programs whose code is JavaScript, read with a parser (`readJavaScript`, #747). */
const JAVASCRIPT = new Set(["node", "deno", "bun"]);

/**
 * JavaScript given on the line, apart from the command's other words: the word after each of its
 * options (`-e <code>`) or the value of one (`--eval=<code>`), and for `deno eval`, every word
 * after it that isn't an option, so its options' values (`--ext ts`) are read as code too.
 */
const javaScriptOf = (words: readonly string[]) => {
  const [program = "", ...rest] = words;
  const code: string[] = [];
  const others: string[] = [];
  let deno = false;
  for (let at = 0; at < rest.length; at += 1) {
    const word = rest[at] ?? "";
    if (deno && !word.startsWith("-")) code.push(word);
    else if (!givesCode(program, word)) others.push(word);
    else if (program === "deno") deno = true;
    else if (word.includes("=")) code.push(word.slice(word.indexOf("=") + 1));
    else {
      code.push(rest[at + 1] ?? "");
      at += 1;
    }
  }
  return { code, others };
};

/** An import's module in text: `from "../x.ts"`, `import("./y")`, `require('z')`. */
const IMPORT = /(?<![.\w$])(?:from|import|require)\s*\(?\s*\\?(['"`])([^'"`\\\s]*)\\?\1/dg;

/** Text without the imports in it whose module `keeps` (#730), as one it writes into a file. */
const withoutImports = (text: string, keeps: (module: string) => boolean) => {
  let kept = text;
  for (const found of text.matchAll(IMPORT)) {
    const [start, end] = found.indices?.[2] ?? [0, 0];
    if (keeps(found[2] ?? ""))
      kept = `${kept.slice(0, start)}${" ".repeat(end - start)}${kept.slice(end)}`;
  }
  return kept;
};

/** A comment's opening or closing marker standing alone in text: no path, though `/*x` stays one. */
const COMMENT_MARKER = /(?<![^\s'"`])(?:\/\*+|\*+\/)(?![^\s'"`])/g;

/**
 * The paths a string in JavaScript could name: the whole of one without spaces (`'/'`, `'/;x'`),
 * comment markers aside, and each of its words, but not a lone `/` beside others in text, as a
 * tag's end (`'<Tabs tabs={A} />'`, #747).
 */
const pathsInString = (text: string) => {
  const whole = /\s/.test(text) || /^[/*]*\*[/*]*$/.test(text) ? [] : [text];
  const words = wordsIn(text.replace(COMMENT_MARKER, " ")).filter((word) => word !== "");
  const named = words.length > 1 ? words.filter((word) => !/^\/+$/.test(word)) : words;
  return [...whole, ...named].flatMap(pathsIn);
};

/** A path in code that names a file of the worktree: `apps/web/src/home.tsx`, not `..` or a name. */
const FILE_IN_CODE = /^(?!\.\.)[\w.-]+(?:\/[\w.-]+)+\.\w+$/;

/**
 * Whether JavaScript given on the line names a path outside the worktree, which it runs in: in
 * its strings, the only place code names one (`readJavaScript`), or in the command's other words;
 * or a folder outside by the function that gives it (`os.homedir()`). One exception (#730): a
 * relative import in a string, so one it writes into a file, that stays inside from the folder of
 * a file the code names (`import { ok } from "../../lib/result.ts"` into
 * `apps/worker/src/features/code/x.ts`): a path that file loads, not one this code opens. Code
 * that doesn't parse names what it might.
 */
const javaScriptReachesOut = (worktree: string, words: readonly string[]) => {
  const { code, others } = javaScriptOf(words);
  const reads = code.map(readJavaScript);
  if (reads.some((read) => read === undefined || read.reachesOut)) return true;
  const strings = reads.flatMap((read) => read?.strings ?? []);
  const folders = strings
    .flatMap(wordsIn)
    .filter((word) => FILE_IN_CODE.test(word) && !outside(worktree, word))
    .map((file) => resolve(worktree, dirname(file)));
  const relativeInside = (module: string) =>
    /^\.\.?\//.test(module) &&
    !isAbsolute(module) &&
    folders.some((from) => !outside(worktree, module, from));
  return [
    ...others.flatMap(pathsIn),
    ...strings.flatMap((text) => pathsInString(withoutImports(text, relativeInside))),
  ].some((path) => outside(worktree, path));
};

/**
 * Whether code given on the line names a path outside the worktree, every path taken from the
 * worktree, which it runs in: JavaScript's as `javaScriptReachesOut` reads it, any other's by its
 * words, comment markers aside.
 */
export const codeReachesOut = (worktree: string, words: readonly string[]) => {
  const code = codeOf(words);
  if (code === undefined) return false;
  if (JAVASCRIPT.has(words[0] ?? "")) return javaScriptReachesOut(worktree, words);
  return wordsIn(code.replace(COMMENT_MARKER, " "))
    .flatMap(pathsIn)
    .some((path) => outside(worktree, path));
};

/** What in Python runs others: processes, sockets and the web, and code it loads or runs by name. */
const PYTHON_RUNS = [
  /\b(?:subprocess|pty|multiprocessing|socket|ssl|urllib|http|requests|ftplib|smtplib|ctypes)\b/,
  /\b(?:system|popen|spawn\w*|fork\w*|exec\w*|eval|compile|getattr|importlib|environ)\b/,
  /__\w+__/,
];

/**
 * Whether code given on the line could run another program, reach the network or load code by a
 * name it works out (#730), so it asks whoever's session it is, Allow all or not: JavaScript's as
 * `readJavaScript` reads it (and any that doesn't parse), Python's by its words. Perl's, Ruby's
 * and PHP's always could (backticks, `system`, a pipe to `open`), so theirs always asks.
 */
export const codeRunsOthers = (words: readonly string[]) => {
  const [program = ""] = words;
  const code = codeOf(words);
  if (code === undefined) return false;
  if (JAVASCRIPT.has(program))
    return javaScriptOf(words).code.some((given) => readJavaScript(given)?.runs !== false);
  if (program.startsWith("py")) return PYTHON_RUNS.some((runs) => runs.test(code));
  return true;
};
