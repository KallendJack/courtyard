// Fails the build if the first load grows past its budget: the scripts the page loads before
// anything else (the entry and what it preloads), gzipped, as a phone on a slow line gets them.
// Each page's own code loads when that page is opened, so it isn't counted here.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const BUDGET_KB = 140;
const dist = join(import.meta.dirname, "..", "dist");
const html = readFileSync(join(dist, "index.html"), "utf8");
const firstLoad = [...html.matchAll(/(?:src|href)="\/(assets\/[^"]+\.js)"/g)].map((m) => m[1]);

let total = 0;
for (const file of firstLoad) {
  total += gzipSync(readFileSync(join(dist, file))).length;
}
const kb = total / 1024;
console.log(
  `First load: ${kb.toFixed(1)} KB gzipped across ${firstLoad.length} scripts (budget ${BUDGET_KB} KB)`,
);
if (kb > BUDGET_KB) {
  console.error(
    `Over budget by ${(kb - BUDGET_KB).toFixed(1)} KB. Load the new code with its page instead.`,
  );
  process.exit(1);
}
