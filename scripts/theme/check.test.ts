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

test("fails a button greyed out while it works, which says it's busy instead (#330)", async () => {
  await source({
    "styles.css": THEME,
    "things/thing-form.tsx": `const accept = "image/*";
export const Save = () => (
  <>
    <Button type="submit" disabled={save.busy}>Save</Button>
    <Button disabled={props.busy || picked === undefined}>Add</Button>
    <Button busy={save.busy} busyLabel="Saving…" disabled={picked === undefined}>Save</Button>
  </>
);`,
  });
  const { passed, said } = await check();
  assert.equal(passed, false);
  assert.match(said, /busy=/);
  assert.match(said, /things\/thing-form\.tsx:4: disabled=\{save\.busy\}/);
  assert.match(
    said,
    /things\/thing-form\.tsx:5: disabled=\{props\.busy \|\| picked === undefined\}/,
  );
  assert.doesNotMatch(said, /thing-form\.tsx:6/);
});

test("fails anything that scrolls by itself, outside the shared scroller (#420)", async () => {
  await source({
    "styles.css": THEME,
    "components/layout/scroller.tsx": `const AXES = { y: "overflow-y-auto", tablet: "md:overflow-auto" };`,
    "review/diff.tsx": `// Scrolls with overflow-y-auto (#278).
export const Lines = () => (
  <>
    <div className="flex md:overflow-y-auto" />
    <pre className="overflow-x-scroll p-3" />
    <div style={{ overflowY: "auto" }} />
    <Scroller axis="x" className="overflow-hidden truncate" />
  </>
);`,
    "sessions/maths.css": `/* overflow: auto would scroll. */
.formula { overflow-x: auto; overflow-y: hidden; }`,
  });
  const { passed, said } = await check();
  assert.equal(passed, false);
  assert.match(said, /Scroller/);
  for (const value of [
    "review/diff.tsx:4: md:overflow-y-auto",
    "review/diff.tsx:5: overflow-x-scroll",
    'review/diff.tsx:6: overflowY: "auto"',
    "sessions/maths.css:2: overflow-x: auto",
  ])
    assert.match(said, new RegExp(value.replace(/[[\]()]/g, "\\$&")));
  assert.doesNotMatch(
    said,
    /scroller\.tsx:|diff\.tsx:[17]|maths\.css:1|overflow-hidden|overflow-y: hidden/,
  );

  // What can't be the shared scroller, an element a library makes, is allowed with its reason.
  await rm(join(root, "src", "review"), { recursive: true });
  const allowed = await check([
    { file: "sessions/maths.css", value: "overflow-x: auto", reason: "KaTeX makes the element." },
  ]);
  assert.deepEqual(allowed, { passed: true, said: "" });
});

test("fails a label in capitals written by hand, outside the shared CapsLabel (#242)", async () => {
  await source({
    "styles.css": THEME,
    "components/layout/caps-label.tsx": `const LOOK = "text-label font-semibold tracking-label uppercase";`,
    "routes/workspace.tsx": `// A label in uppercase, the old way (#232).
export const Above = () => (
  <>
    <span className="text-meta/4 font-semibold tracking-label text-muted-foreground uppercase" />
    <p className="md:uppercase" />
    <CapsLabel tone="muted">Workspace</CapsLabel>
  </>
);`,
    "sessions/notes.css": `/* text-transform: uppercase would shout. */
.note { text-transform: uppercase; }`,
  });
  const { passed, said } = await check();
  assert.equal(passed, false);
  assert.match(said, /CapsLabel/);
  for (const value of [
    "routes/workspace.tsx:4: uppercase",
    "routes/workspace.tsx:5: md:uppercase",
    "sessions/notes.css:2: text-transform: uppercase",
  ])
    assert.match(said, new RegExp(value));
  assert.doesNotMatch(said, /caps-label\.tsx:|workspace\.tsx:[167]|notes\.css:1/);

  // What isn't a section's label, a mark in a pill, is allowed with its reason.
  await rm(join(root, "src", "sessions"), { recursive: true });
  const allowed = await check([
    { file: "routes/workspace.tsx", value: "uppercase", reason: "A pill's mark." },
    { file: "routes/workspace.tsx", value: "md:uppercase", reason: "A pill's mark." },
  ]);
  assert.deepEqual(allowed, { passed: true, said: "" });
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
