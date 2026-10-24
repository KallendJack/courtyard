import { dirname, isAbsolute, resolve } from "node:path";
import { outside, pathsIn } from "./paths.ts";

/**
 * Code given on the line (`node -e`, `python -c`, #464), read by its text: the paths it names,
 * and whether it could run another program or reach the network, so routine code (#730) and
 * Allow all (#428) never cover that. A check of words, not of what the code does: it catches a
 * model's mistakes, never code written to slip past it, and a script the session writes and runs
 * is its own code either way (ADR 0038).
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

/** The programs whose code is JavaScript. */
const JAVASCRIPT = new Set(["node", "deno", "bun"]);

/**
 * JavaScript's string literals, by where their text starts and ends; `undefined` where the code
 * could hide where one starts from a reader this simple: a `/` outside them (a comment or a
 * regular expression), an HTML-like comment, a template's `${`, a line break in a quote, or a
 * quote that doesn't close.
 */
const stringsIn = (code: string) => {
  const found: { readonly start: number; readonly end: number }[] = [];
  for (let at = 0; at < code.length; at += 1) {
    const quote = code[at] ?? "";
    if (quote === "/" || code.startsWith("<!--", at) || code.startsWith("-->", at))
      return undefined;
    if (quote !== "'" && quote !== '"' && quote !== "`") continue;
    let end = at + 1;
    for (; end < code.length && code[end] !== quote; end += 1) {
      if (code[end] === "\\") end += 1;
      else if (quote === "`" && code.startsWith("${", end)) return undefined;
      else if (quote !== "`" && code[end] === "\n") return undefined;
    }
    if (end >= code.length) return undefined;
    found.push({ start: at + 1, end });
    at = end;
  }
  return found;
};

/** An import's module, in code or in text: `from "../x.ts"`, `import("./y")`, `require('z')`. */
const IMPORT = /(?<![.\w$])(?:from|import|require)\s*\(?\s*\\?(['"`])([^'"`\\\s]*)\\?\1/dg;

/**
 * Code without the imports it writes into a file whose module `keeps` (#730): each import inside
 * one of its JavaScript strings, so text it writes, not one it loads. Nothing is taken out of code
 * that could hide its strings (`stringsIn`).
 */
const withoutWrittenImports = (code: string, keeps: (module: string) => boolean) => {
  const strings = stringsIn(code);
  if (strings === undefined) return code;
  let kept = code;
  for (const found of code.matchAll(IMPORT)) {
    const [start, end] = found.indices?.[2] ?? [0, 0];
    const written = strings.some((text) => text.start <= found.index && end <= text.end);
    if (written && keeps(found[2] ?? ""))
      kept = `${kept.slice(0, start)}${" ".repeat(end - start)}${kept.slice(end)}`;
  }
  return kept;
};

/** A path in code that names a file of the worktree: `apps/web/src/home.tsx`, not `..` or a name. */
const FILE_IN_CODE = /^(?!\.\.)[\w.-]+(?:\/[\w.-]+)+\.\w+$/;

/**
 * Whether code given on the line names a path outside the worktree, every path taken from the
 * worktree, which it runs in. One exception (#730): a relative import written into a file, inside
 * one of JavaScript's strings, that stays inside from the folder of a file the code names (`import
 * { ok } from "../../lib/result.ts"` into `apps/worker/src/features/code/x.ts`): a path that file
 * loads, not one this code opens. Paths given to the file system's or path's functions never are.
 */
export const codeReachesOut = (worktree: string, words: readonly string[]) => {
  const code = codeOf(words);
  if (code === undefined) return false;
  const folders = wordsIn(code)
    .filter((word) => FILE_IN_CODE.test(word) && !outside(worktree, word))
    .map((file) => resolve(worktree, dirname(file)));
  const relativeInside = (module: string) =>
    /^\.\.?\//.test(module) &&
    !isAbsolute(module) &&
    folders.some((from) => !outside(worktree, module, from));
  const opened = JAVASCRIPT.has(words[0] ?? "")
    ? withoutWrittenImports(code, relativeInside)
    : code;
  return wordsIn(opened)
    .flatMap(pathsIn)
    .some((path) => outside(worktree, path));
};

/**
 * What in JavaScript runs another program, reaches the network or loads code it can't be read for
 * (#730): child processes and workers, `fetch` and sockets, node's bindings and native modules,
 * `vm` and `eval`, a `require` or `import` of a name it works out, and escapes that spell a name.
 */
const JAVASCRIPT_RUNS = [
  /child_process|worker_threads|\bcluster\b/,
  /\b(?:spawn|fork)\w*|(?<!\.)\bexec\w*|\.exec(?:Sync|File|FileSync|a)\b/,
  /\b(?:fetch|WebSocket|XMLHttpRequest|EventSource)\b/,
  /(['"`])(?:node:)?(?:https?|http2|net|dgram|tls|dns|inspector|vm|module|process)\1/,
  /\bprocess\s*(?:\[|\.\s*(?:binding|_linkedBinding|dlopen|getBuiltinModule|mainModule|env|kill|execve))/,
  /\b(?:vm|eval|Function|Reflect|globalThis|global|constructor|createRequire|dlopen)\b/,
  /\b(?:Bun|Deno)\s*[.[]/,
  /\brequire\b(?!\s*\(\s*(['"])[^'"`\\]*\1\s*\))/,
  /\bimport\s*\((?!\s*(['"])[^'"`\\]*\1\s*\))/,
  /\\[ux0-7]/,
];

/** The same for Python: processes, sockets and the web, and code it loads or runs by a name. */
const PYTHON_RUNS = [
  /\b(?:subprocess|pty|multiprocessing|socket|ssl|urllib|http|requests|ftplib|smtplib|ctypes)\b/,
  /\b(?:system|popen|spawn\w*|fork\w*|exec\w*|eval|compile|getattr|importlib|environ)\b/,
  /__\w+__/,
];

/**
 * Whether code given on the line could run another program, reach the network or load code by a
 * name it works out (#730), so it asks whoever's session it is, Allow all or not. Perl's, Ruby's
 * and PHP's always could (backticks, `system`, a pipe to `open`), so theirs always asks.
 */
export const codeRunsOthers = (words: readonly string[]) => {
  const [program = ""] = words;
  const code = codeOf(words);
  if (code === undefined) return false;
  if (JAVASCRIPT.has(program)) return JAVASCRIPT_RUNS.some((runs) => runs.test(code));
  if (program.startsWith("py")) return PYTHON_RUNS.some((runs) => runs.test(code));
  return true;
};
