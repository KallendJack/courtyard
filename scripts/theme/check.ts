// The theme guard (#232), run by `pnpm verify`. The web app's look is one theme, in
// apps/web/src/styles.css: everywhere else uses its names, never values. This fails on a size,
// colour, radius, shadow or ring written by value in a Tailwind class (`text-[13px]`,
// `shadow-[0_0_8px_red]`, `text-sm/[18px]`), and on a colour's hex outside styles.css. A real
// one-off goes on the allowlist, allowed.json, with the reason it can't be the theme's; an entry
// nothing needs any more fails too, so the list stays short. It also fails a button greyed out
// while it works (`disabled={save.busy}`), which shows it's busy instead (#330).
//
//   node scripts/theme/check.ts [<web app's src folder> <allowlist>]

import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { z } from "zod";

const [
  src = join(import.meta.dirname, "../../apps/web/src"),
  allowlist = join(import.meta.dirname, "allowed.json"),
] = process.argv.slice(2);

const Allowed = z.array(
  z.object({
    /** The file, from the web app's src folder. */
    file: z.string().min(1),
    /** The class or hex, exactly as written. */
    value: z.string().min(1),
    reason: z.string().trim().min(1, "Each allowed value needs a reason."),
  }),
);

/** The theme itself, and what the router writes. */
const SKIPPED = new Set(["styles.css", "routeTree.gen.ts"]);

/** Tailwind utilities that take a colour, a size, a radius, a shadow or a ring. */
const STYLED =
  /^-?(?:text|bg|border(?:-[xytrblse])?|outline|ring(?:-offset)?|inset-ring|shadow|inset-shadow|drop-shadow|rounded(?:-(?:[tblrse]|tl|tr|bl|br|ss|se|es|ee|s|e))?|fill|stroke|decoration|accent|caret|divide(?:-[xy])?|from|via|to|placeholder)-\[/;
/** A type size with its line height by value: `text-sm/[18px]`. */
const LINE_HEIGHT = /^text-[\w.-]+\/\[/;
const HEX = /(?<![\w&#])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/g;

/** A class without its variants (`md:`, `data-[status=active]:`): what comes after the last `:` outside brackets. */
const utilityOf = (token: string) => {
  let depth = 0;
  let start = 0;
  for (const [at, char] of [...token].entries()) {
    if (char === "[" || char === "(") depth += 1;
    else if (char === "]" || char === ")") depth -= 1;
    else if (char === ":" && depth === 0) start = at + 1;
  }
  return token.slice(start);
};

/** The text with its comments blanked out, keeping its lines, so an issue's number (#160) isn't a colour. */
const withoutComments = (text: string, css: boolean) =>
  text.replace(css ? /\/\*[\s\S]*?\*\//g : /\/\*[\s\S]*?\*\/|(?<![:\\])\/\/.*/g, (comment) =>
    comment.replace(/[^\n]/g, " "),
  );

type Problem = { readonly file: string; readonly line: number; readonly value: string };

const problemsIn = (file: string, text: string): Problem[] => {
  const css = file.endsWith(".css");
  const problems: Problem[] = [];
  for (const [index, line] of withoutComments(text, css).split("\n").entries()) {
    const classes = css
      ? []
      : line
          .split(/[\s"'`]+/)
          .filter((token) => STYLED.test(utilityOf(token)) || LINE_HEIGHT.test(utilityOf(token)))
          .map((token) => token.replace(/[,;)}]+$/, ""));
    for (const value of classes) problems.push({ file, line: index + 1, value });
    // A hex inside a class just named (`bg-[#123456]`) is the same problem.
    for (const [hex] of line.matchAll(HEX))
      if (!classes.some((value) => value.includes(hex)))
        problems.push({ file, line: index + 1, value: hex });
  }
  return problems;
};

const files = (await readdir(src, { recursive: true }))
  .map((path) => path.split(sep).join("/"))
  .filter((path) => /\.(tsx?|css)$/.test(path) && !SKIPPED.has(path));

const parsed = Allowed.safeParse(JSON.parse(await readFile(allowlist, "utf8")));
if (!parsed.success) {
  console.error(`${relative(process.cwd(), allowlist)}: ${z.prettifyError(parsed.error)}`);
  process.exit(1);
}
const allowed = parsed.data;
const isAllowed = (problem: Problem) =>
  allowed.some((entry) => entry.file === problem.file && entry.value === problem.value);

const found = (
  await Promise.all(
    files.map(async (file) => problemsIn(file, await readFile(join(src, file), "utf8"))),
  )
).flat();
const problems = found.filter((problem) => !isAllowed(problem));

/**
 * A button greyed out while what the owner tapped runs (#330): greyed out means it can't right
 * now, so one that's working says so with `busy` (or `waiting`, beside one that is).
 */
const GREYED_WHILE_BUSY = /\bdisabled=\{[^}]*\bbusy\b[^}]*\}/g;
const greyedWhileBusy = (
  await Promise.all(
    files
      .filter((file) => file.endsWith(".tsx"))
      // As written, comments too: a string such as "image/*" would read as one opening.
      .map(async (file) =>
        (await readFile(join(src, file), "utf8")).split("\n").flatMap((line, index) =>
          [...line.matchAll(GREYED_WHILE_BUSY)].map(([value]) => ({
            file,
            line: index + 1,
            value,
          })),
        ),
      ),
  )
).flat();
const unused = allowed.filter(
  (entry) => !found.some((problem) => problem.file === entry.file && problem.value === entry.value),
);

if (problems.length > 0) {
  console.error(
    "Styles by value, not by the theme's names (apps/web/src/styles.css). Use a name, add one to the theme, or allow a real one-off in scripts/theme/allowed.json with its reason:",
  );
  for (const { file, line, value } of problems) console.error(`  ${file}:${line}: ${value}`);
}
if (unused.length > 0) {
  console.error(
    "Allowed in scripts/theme/allowed.json, but nothing uses it any more; take it off:",
  );
  for (const { file, value } of unused) console.error(`  ${file}: ${value}`);
}
if (greyedWhileBusy.length > 0) {
  console.error(
    "Greyed out while it works: a working button keeps its colour with busy={…} and busyLabel, and the ones beside it wait with waiting={…} (#330):",
  );
  for (const { file, line, value } of greyedWhileBusy) console.error(`  ${file}:${line}: ${value}`);
}
if (problems.length > 0 || unused.length > 0 || greyedWhileBusy.length > 0) process.exit(1);
