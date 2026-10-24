// The folders guard (#445, #453, #459), run by `pnpm check`. Both apps use familiar folder names,
// docs/overview.md lists every feature, and each feature has a README that docs/architecture.md
// links, so the docs and the folders can't drift apart. This fails on a folder or file at the top
// of an app's src that isn't one of its own (below), a feature folder the overview doesn't list
// for that app, a listed feature with no folder, and a folder that needs a README (every feature,
// each of the worker's auth and integrations, its providers and prompts) with none or one
// docs/architecture.md doesn't link. How many files a folder holds is the house size check's
// (packages/house/check-size.ts, ADR 0035). The shared pieces both apps use, packages/ui (#703), keep
// to their own folders too.
//
//   node scripts/folders/check.ts [<worker's src> <web app's src> <overview> <architecture> <packages/ui>]

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const [
  workerSrc = join(import.meta.dirname, "../../apps/worker/src"),
  webSrc = join(import.meta.dirname, "../../apps/web/src"),
  overview = join(import.meta.dirname, "../../docs/overview.md"),
  architecture = join(import.meta.dirname, "../../docs/architecture.md"),
  uiPackage = join(import.meta.dirname, "../../packages/ui"),
] = process.argv.slice(2);

type App = {
  name: "Worker" | "Web" | "UI";
  src: string;
  folders: readonly string[];
  files: readonly string[];
  /** Folders each of whose subfolders has a README. */
  readmeEach: readonly string[];
  /** Folders that have a README themselves. */
  readmeOwn: readonly string[];
  /** Where the app is, as docs/architecture.md links into it. */
  linkedAs: string;
};

const APPS: readonly App[] = [
  {
    name: "Worker",
    src: workerSrc,
    folders: ["features", "providers", "prompts", "auth", "integrations", "config", "lib"],
    files: ["main.ts", "start.ts", "worker.ts"],
    readmeEach: ["features", "auth", "integrations"],
    readmeOwn: ["providers", "prompts"],
    linkedAs: "../apps/worker/src",
  },
  {
    name: "Web",
    src: webSrc,
    folders: ["features", "components", "hooks", "api", "routes", "lib"],
    files: ["main.tsx", "styles.css", "routeTree.gen.ts"],
    readmeEach: ["features"],
    readmeOwn: [],
    linkedAs: "../apps/web/src",
  },
  {
    name: "UI",
    src: uiPackage,
    folders: ["buttons", "forms", "frame", "hooks", "layout", "lib", "reply"],
    files: ["README.md", "package.json", "theme.css", "tsconfig.json"],
    readmeEach: [],
    readmeOwn: [],
    linkedAs: "../packages/ui",
  },
];

/** What's directly inside a folder: its folders and its files, each sorted; never what's installed. */
const contentsOf = async (path: string) => {
  const entries = (await readdir(path, { withFileTypes: true })).filter(
    (entry) => entry.name !== "node_modules",
  );
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
  const needReadmes = [
    ...app.readmeOwn.filter((name) => top.folders.includes(name)),
    ...(
      await Promise.all(
        app.readmeEach
          .filter((name) => top.folders.includes(name))
          .map(async (folder) =>
            (await contentsOf(join(app.src, folder))).folders.map((name) => `${folder}/${name}`),
          ),
      )
    ).flat(),
  ];
  for (const folder of needReadmes) {
    if (!(await contentsOf(join(app.src, folder))).files.includes("README.md")) {
      problems.push(
        `${app.name}: ${folder}/ has no README.md: what it does, one example, what it uses, what uses it, and its API or screens.`,
      );
      continue;
    }
    const link = `${app.linkedAs}/${folder}/README.md`;
    if (!architectureText.includes(`(${link})`)) {
      problems.push(
        `${app.name}: docs/architecture.md doesn't link ${folder}/README.md (as ${link}).`,
      );
    }
  }
}

if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}
