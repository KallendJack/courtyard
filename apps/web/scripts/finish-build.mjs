// Runs after `vite build`:
// 1. Fills in the service worker's build name and the list of the app's files, so each build
//    keeps its own files and every page works offline once the app is installed.
// 2. Fails the build if the first load grows past its budget: everything the home page needs
//    before it shows (scripts and styles, gzipped, as a phone on a slow line gets them). Other
//    pages' code loads when they're opened, so it isn't counted.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const BUDGET_KB = 143;
/** The route files the home page needs as well as the entry: the logged-in layout and the list. */
const HOME_ROUTES = ["src/routes/_app.tsx", "src/routes/_app/index.tsx"];

const dist = join(import.meta.dirname, "..", "dist");
const manifest = JSON.parse(readFileSync(join(dist, ".vite", "manifest.json"), "utf8"));

// 1. The service worker.
const assets = readdirSync(join(dist, "assets")).map((file) => `/assets/${file}`);
const icons = readdirSync(join(dist, "icons")).map((file) => `/icons/${file}`);
const files = [...assets, ...icons, "/manifest.webmanifest"].sort();
const build = createHash("sha256")
  .update(files.join("\n"))
  .update(readFileSync(join(dist, "index.html")))
  .digest("hex")
  .slice(0, 12);
const swPath = join(dist, "sw.js");
const sw = readFileSync(swPath, "utf8")
  .replace("__COURTYARD_BUILD__", build)
  .replace("/* __COURTYARD_FILES__ */ []", JSON.stringify(files));
if (sw.includes("__COURTYARD_")) throw new Error("sw.js still has a placeholder");
writeFileSync(swPath, sw);
console.log(`Service worker: build ${build}, ${files.length} files kept on install`);

// 2. The first load: the entry, the home page's route files, and everything they import.
const firstLoad = new Set();
const add = (key) => {
  const chunk = manifest[key];
  if (!chunk || firstLoad.has(chunk.file)) return;
  firstLoad.add(chunk.file);
  for (const css of chunk.css ?? []) firstLoad.add(css);
  for (const imported of chunk.imports ?? []) add(imported);
};
const entry = Object.keys(manifest).find((key) => manifest[key].isEntry);
if (!entry)
  throw new Error("No entry in the build manifest: the size check can't measure anything");
add(entry);
for (const route of HOME_ROUTES) {
  // The router splits each route file into pieces named `<file>?tsr-split=<piece>`.
  const pieces = Object.keys(manifest).filter((key) => key.split("?")[0] === route);
  if (pieces.length === 0) throw new Error(`${route} isn't in the build: update HOME_ROUTES`);
  for (const piece of pieces) add(piece);
}

let total = 0;
for (const file of firstLoad) total += gzipSync(readFileSync(join(dist, file))).length;
const kb = total / 1024;
console.log(
  `First load: ${kb.toFixed(1)} KB gzipped across ${firstLoad.size} files (budget ${BUDGET_KB} KB)`,
);
if (kb > BUDGET_KB) {
  console.error(`Over budget by ${(kb - BUDGET_KB).toFixed(1)} KB. Load new code with its page.`);
  process.exit(1);
}
