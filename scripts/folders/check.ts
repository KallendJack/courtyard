// The folders guard (#445, #453), run by `pnpm check`. Both apps use familiar folder names, and
// docs/overview.md lists every feature, so the docs and the folders can't drift apart. This fails
// on a folder or file at the top of an app's src that isn't one of its own (below), a feature
// folder the overview doesn't list for that app, a listed feature with no folder, and a worker
// feature, auth or integrations folder that docs/architecture.md doesn't describe (as `name/`).
//
//   node scripts/folders/check.ts [<worker's src> <web app's src> <overview> <architecture>]

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const [
  workerSrc = join(import.meta.dirname, "../../apps/worker/src"),
  webSrc = join(import.meta.dirname, "../../apps/web/src"),
  overview = join(import.meta.dirname, "../../docs/overview.md"),
  architecture = join(import.meta.dirname, "../../docs/architecture.md"),
] = process.argv.slice(2);

type App = {
  name: "Worker" | "Web";
  src: string;
  folders: readonly string[];
  files: readonly string[];
  /** Folders whose subfolders the architecture doc describes. */
  described: readonly string[];
};

const APPS: readonly App[] = [
  {
    name: "Worker",
    src: workerSrc,
    folders: ["features", "providers", "prompts", "auth", "integrations", "config", "lib"],
    files: ["main.ts", "start.ts", "worker.ts"],
    described: ["features", "auth", "integrations"],
  },
  {
    name: "Web",
    src: webSrc,
    folders: ["features", "components", "hooks", "api", "routes", "lib"],
    files: ["main.tsx", "styles.css", "routeTree.gen.ts"],
    described: [],
  },
];

/** What's directly inside a folder: its folders and its files, each sorted. */
const contentsOf = async (path: string) => {
  const entries = await readdir(path, { withFileTypes: true });
  const names = (folders: boolean) =>
    entries
      .filter((entry) => entry.isDirectory() === folders)
      .map((entry) => entry.name)
      .sort();
  return { folders: names(true), files: names(false) };
};

/** The features the overview lists for an app: the backticked names on its `**<app> features:**` lines. */
const listedIn = (text: string, app: App["name"]) => {
  const features = new Set<string>();
  const lines = text.split("\n");
  for (const [at, line] of lines.entries()) {
    if (!line.startsWith(`**${app} features:**`)) continue;
    for (const next of [line, ...lines.slice(at + 1)]) {
      if (next !== line && (next.trim() === "" || next.startsWith("**"))) break;
      for (const name of next.matchAll(/`([^`]+)`/g)) if (name[1]) features.add(name[1]);
    }
  }
  return features;
};

const overviewText = await readFile(overview, "utf8");
const architectureText = await readFile(architecture, "utf8");
const problems: string[] = [];

for (const app of APPS) {
  const top = await contentsOf(app.src);
  for (const folder of top.folders) {
    if (!app.folders.includes(folder)) {
      problems.push(
        `${app.name}: ${folder}/ isn't one of its folders (${app.folders.join(", ")}): move it into one (docs/overview.md).`,
      );
    }
  }
  for (const file of top.files) {
    if (!app.files.includes(file)) {
      problems.push(`${app.name}: ${file} belongs in one of its folders, not at the top.`);
    }
  }
  const listed = listedIn(overviewText, app.name);
  const features = top.folders.includes("features")
    ? (await contentsOf(join(app.src, "features"))).folders
    : [];
  for (const feature of features) {
    if (!listed.has(feature)) {
      problems.push(`${app.name}: features/${feature}/ isn't listed in docs/overview.md.`);
    }
  }
  for (const feature of listed) {
    if (!features.includes(feature)) {
      problems.push(
        `${app.name}: docs/overview.md lists ${feature}, but there's no features/${feature}/.`,
      );
    }
  }
  for (const folder of app.described.filter((name) => top.folders.includes(name))) {
    for (const name of (await contentsOf(join(app.src, folder))).folders) {
      if (!architectureText.includes(`\`${name}/\``)) {
        problems.push(
          `${app.name}: ${folder}/${name}/ isn't described in docs/architecture.md (as \`${name}/\`).`,
        );
      }
    }
  }
}

if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}
