// The areas guard (#445), run by `pnpm check`. The worker's modules live in seven areas, one
// folder each in apps/worker/src (the contract is its own package). This fails on a folder there
// that isn't an area, a module whose area in docs/overview.md isn't the folder it's in, a module
// the overview doesn't list or architecture.md doesn't describe (as `name/`), and an overview
// entry with no folder, so the docs and the folders can't drift apart.
//
//   node scripts/areas/check.ts [<worker's src folder> <overview> <architecture>]

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const [
  src = join(import.meta.dirname, "../../apps/worker/src"),
  overview = join(import.meta.dirname, "../../docs/overview.md"),
  architecture = join(import.meta.dirname, "../../docs/architecture.md"),
] = process.argv.slice(2);

/** The folders directly inside a folder. */
const foldersIn = async (path: string) =>
  (await readdir(path, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

/**
 * Each area the overview names, with the modules it lists: an area is a `### <icon> <name>: …`
 * heading, and its modules are the backticked names on the lines up to the next blank line (a
 * path, such as the contract's `packages/contract`, isn't a worker module).
 */
const areasIn = (text: string) => {
  const areas = new Map<string, string[]>();
  const lines = text.split("\n");
  for (const [at, line] of lines.entries()) {
    const heading = /^### \S+ ([a-z-]+): /.exec(line);
    if (!heading?.[1]) continue;
    const modules: string[] = [];
    for (const next of lines.slice(at + 2)) {
      if (next.trim() === "") break;
      for (const name of next.matchAll(/`([^`]+)`/g)) {
        if (name[1] && !name[1].includes("/")) modules.push(name[1]);
      }
    }
    areas.set(heading[1], modules);
  }
  return areas;
};

const listed = areasIn(await readFile(overview, "utf8"));
const described = await readFile(architecture, "utf8");
const problems: string[] = [];

const areaOf = new Map<string, string>();
for (const [area, modules] of listed) for (const name of modules) areaOf.set(name, area);

const found = new Set<string>();
for (const folder of await foldersIn(src)) {
  if (!listed.has(folder)) {
    problems.push(
      `${folder}/ isn't one of the areas: move it into the area it belongs to (docs/overview.md).`,
    );
    continue;
  }
  for (const name of await foldersIn(join(src, folder))) {
    found.add(name);
    const area = areaOf.get(name);
    if (area === undefined) problems.push(`${folder}/${name}/ isn't listed in docs/overview.md.`);
    else if (area !== folder) {
      problems.push(`${folder}/${name}/ is listed under ${area} in docs/overview.md.`);
    }
    if (!described.includes(`\`${name}/\``)) {
      problems.push(
        `${folder}/${name}/ isn't described in docs/architecture.md (as \`${name}/\`).`,
      );
    }
  }
}
for (const [name, area] of areaOf) {
  if (!found.has(name)) {
    problems.push(`docs/overview.md lists ${name} under ${area}, but there's no such folder.`);
  }
}

if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}
