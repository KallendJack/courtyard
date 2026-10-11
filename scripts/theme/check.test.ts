// The theme guard (#232), run as `pnpm verify` runs it, against a web app's source made up here.
//
//   node --test scripts/theme/

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";

const CHECK = join(import.meta.dirname, "check.ts");

let root = "";
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "courtyard-theme-check-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** A web app's source: each file's path in `src` and what's in it. */
const source = async (files: Readonly<Record<string, string>>) => {
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, "src", path)), { recursive: true });
    await writeFile(join(root, "src", path), text);
  }
};

/** Runs the guard on that source with an allowlist; what it says, and whether it passed. */
const check = async (allowed: readonly object[] = []) => {
  await writeFile(join(root, "allowed.json"), JSON.stringify(allowed));
  const run = spawnSync(process.execPath, [CHECK, join(root, "src"), join(root, "allowed.json")], {
    encoding: "utf8",
  });
  return { passed: run.status === 0, said: `${run.stdout}${run.stderr}` };
};

const THEME = "@theme inline { --color-primary: #9d6bff; --text-meta: 13px; }";

test("passes a component that uses the theme's names", async () => {
  await source({
    "styles.css": THEME,
    "components/chip.tsx": `// A chip (#160).
export const Chip = () => <span className="rounded-row bg-primary text-meta/5 shadow-glow ring-1 data-[status=active]:bg-muted" />;`,
  });
  assert.deepEqual(await check(), { passed: true, said: "" });
});

test("fails a size, colour, radius, shadow or ring written by value, naming each", async () => {
  await source({
    "styles.css": THEME,
    "components/chip.tsx": `export const Chip = () => (
  <span className="text-[13px] md:bg-[#123456] rounded-[6px] shadow-[0_0_8px_red] ring-[1.5px]" />
);`,
    "sessions/turn.tsx": `export const Turn = () => <p className="text-sm/[18px]" />;`,
  });
  const { passed, said } = await check();
  assert.equal(passed, false);
  for (const value of [
    "components/chip.tsx:2: text-[13px]",
    "components/chip.tsx:2: md:bg-[#123456]",
    "components/chip.tsx:2: rounded-[6px]",
    "components/chip.tsx:2: shadow-[0_0_8px_red]",
    "components/chip.tsx:2: ring-[1.5px]",
    "sessions/turn.tsx:1: text-sm/[18px]",
  ])
    assert.match(said, new RegExp(value.replace(/[[\]()]/g, "\\$&")));
});

test("fails a colour by its hex outside styles.css, but not an issue named in a comment", async () => {
  await source({
    "styles.css": THEME,
    "photo.ts": `// White behind a photo's see-through parts (#78).
context.fillStyle = "#ffffff";`,
    "things/things.css": `/* Things (#150). */
.thing { color: #c9a26b; }`,
  });
  const { passed, said } = await check();
  assert.equal(passed, false);
  assert.match(said, /photo\.ts:2: #ffffff/);
  assert.match(said, /things\/things\.css:2: #c9a26b/);
  assert.doesNotMatch(said, /#78|#150/);
});

test("passes a one-off on the allowlist, which has to say why", async () => {
  await source({ "styles.css": THEME, "photo.ts": `context.fillStyle = "#ffffff";` });
  const entry = { file: "photo.ts", value: "#ffffff" };

  assert.equal(
    (await check([{ ...entry, reason: "A canvas can't read the theme." }])).passed,
    true,
  );
  const unexplained = await check([{ ...entry, reason: "" }]);
  assert.equal(unexplained.passed, false);
  assert.match(unexplained.said, /reason/);
});

test("fails an allowlist entry nothing needs any more, so the list stays short", async () => {
  await source({ "styles.css": THEME });
  const { passed, said } = await check([
    { file: "photo.ts", value: "#ffffff", reason: "A canvas can't read the theme." },
  ]);
  assert.equal(passed, false);
  assert.match(said, /photo\.ts.*#ffffff/);
});
