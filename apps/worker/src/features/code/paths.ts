import { isAbsolute, relative, resolve } from "node:path";
import type { CommandRule } from "./allowlist.ts";

/**
 * The paths a command names (ADR 0007): whether any is outside the worktree, read from its words
 * as the allowlist matched them, so a command naming one asks however it's spelt.
 */

/**
 * The paths an argument could name: itself; whatever follows an `=` or a `:` in it
 * (`--option=value`, `HEAD:path`), a drive's colon aside; and, for short options, whatever follows
 * each of their letters (`attachedValues`), but not the rest of that value (`-L13,13:apps/x`, #730).
 */
export const pathsIn = (argument: string) => {
  const paths = [argument];
  for (let at = 0; at < argument.length; at += 1) {
    const char = argument[at];
    const drive = char === ":" && at === 1 && /^[A-Za-z]$/.test(argument[0] ?? "");
    if ((char === "=" || char === ":") && !drive) paths.push(argument.slice(at + 1));
  }
  return [...paths, ...attachedValues(argument)];
};

/**
 * What a short option could have written onto it as its value: whatever follows each of its
 * letters, after others too (`-t.claude`, `-qF../x`); nothing for a word that isn't one.
 */
export const attachedValues = (argument: string) => {
  const values: string[] = [];
  if (!/^-[^-]/.test(argument)) return values;
  for (let at = 2; at < argument.length && /[A-Za-z]/.test(argument[at - 1] ?? ""); at += 1)
    values.push(argument.slice(at));
  return values;
};

/** A search's options that give its pattern (#730): never a path. */
const PATTERN_OPTIONS = new Set(["-e", "--regexp"]);
/** And those that read patterns from a file, so no word is the pattern. */
const PATTERN_FILES = new Set(["-f", "--file"]);

/**
 * Which of a search's words after its rule's is its pattern (#730): the value of each `-e`, or,
 * with none and no patterns file, its first word that isn't an option.
 */
const patternsOf = (rest: readonly string[]) => {
  const given = rest.flatMap((_, at) => (PATTERN_OPTIONS.has(rest[at - 1] ?? "") ? [at] : []));
  if (given.length > 0 || rest.some((word) => PATTERN_FILES.has(word))) return new Set(given);
  const first = rest.findIndex((word) => !word.startsWith("-"));
  return new Set(first === -1 ? [] : [first]);
};

/**
 * The paths a command matching a rule could name: those in each argument after the rule's words
 * (`pathsIn`), but only the whole of a text option's value (`texts`), so a link in a pull
 * request's body isn't read as a path (#202), and none in a search's pattern (#730).
 */
const pathsNamed = (rule: CommandRule, words: readonly string[]) => {
  const rest = words.slice(rule.words.length);
  const texts = new Set(rule.texts);
  const patterns = rule.searches === true ? patternsOf(rest) : new Set<number>();
  const paths: string[] = [];
  for (let at = 0; at < rest.length; at += 1) {
    const word = rest[at] ?? "";
    const equals = word.startsWith("--") ? word.indexOf("=") : -1;
    if (patterns.has(at)) continue;
    if (texts.has(word)) {
      paths.push(word, ...rest.slice(at + 1, at + 2));
      at += 1;
    } else if (equals !== -1 && texts.has(word.slice(0, equals))) {
      paths.push(word.slice(equals + 1));
    } else {
      paths.push(...pathsIn(word));
    }
  }
  return paths;
};

/**
 * Whether a path, taken from `from` (a folder of the worktree, or the worktree itself), is outside
 * the worktree: one from the home folder (`~`), an absolute one elsewhere, one that climbs out with
 * `..`, or one naming a drive that isn't absolute here (`C:/x` off Windows, `C:x` on it), whose
 * place the worker can't tell.
 */
export const outside = (worktree: string, path: string, from = worktree) => {
  if (path.startsWith("~")) return true;
  const absolute = isAbsolute(path);
  if (/^[A-Za-z]:/.test(path) && !absolute) return true;
  if (!absolute && !path.split(/[\\/]/).includes("..")) return false;
  const fromWorktree = relative(worktree, resolve(from, path));
  return fromWorktree.startsWith("..") || isAbsolute(fromWorktree);
};

/**
 * Whether a command matching a rule names a path outside the worktree (`pathsNamed`), taking
 * relative ones from the folder the rule says it runs in (pnpm's `-C`, #730), itself inside.
 */
export const reachesOut = (worktree: string, rule: CommandRule, words: readonly string[]) => {
  const folder = rule.runsIn?.(words.slice(rule.words.length));
  if (folder !== undefined && outside(worktree, folder)) return true;
  const from = folder === undefined ? worktree : resolve(worktree, folder);
  return pathsNamed(rule, words).some((path) => outside(worktree, path, from));
};
