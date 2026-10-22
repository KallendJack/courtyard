// The size check (ADR 0035), run as a repo's check script runs it, in real git repos made up here.
//
//   node --test packages/house/check-size.test.ts

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";

const CHECK = join(import.meta.dirname, "check-size.ts");
const LIST = "scripts/check-size.json";

let root = "";
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "courtyard-check-size-"));
  spawnSync("git", ["init", "-q"], { cwd: root });
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const lines = (count: number) =>
  `${Array.from({ length: count }, (_, at) => `// ${at}`).join("\n")}\n`;

const write = async (path: string, text: string) => {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), text);
};

const listed = (list: { files?: Record<string, number>; folders?: Record<string, number> }) =>
  write(LIST, `${JSON.stringify({ files: {}, folders: {}, ...list }, null, 2)}\n`);

const check = (...args: string[]) => {
  const run = spawnSync(process.execPath, [CHECK, ...args], { cwd: root, encoding: "utf8" });
  return { status: run.status, out: `${run.stdout}${run.stderr}` };
};

test("passes a repo whose files and folders are small", async () => {
  await write("src/app.ts", lines(400));
  await write("src/page.tsx", lines(12));
  const { status, out } = check();
  assert.equal(status, 0, out);
});

test("fails a source file over 400 lines, untracked ones too", async () => {
  await write("src/features/customers/page.tsx", lines(401));
  const { status, out } = check();
  assert.equal(status, 1);
  assert.match(out, /src\/features\/customers\/page\.tsx has 401 lines: split it/);
});

test("leaves out tests, fixtures, generated and vendored files, and what isn't source", async () => {
  for (const path of [
    "src/page.test.ts",
    "e2e/customers.spec.ts",
    "test/helpers.ts",
    "test-fixtures/customers/made-up.ts",
    "src/routeTree.gen.ts",
    "worker-configuration.d.ts",
    "public/vendor/exceljs.min.js",
    "docs/architecture.md",
    "migrations/0001_customers.sql",
  ]) {
    await write(path, lines(900));
  }
  const { status, out } = check();
  assert.equal(status, 0, out);
});

test("fails a folder of more than 15 source files, counting only source", async () => {
  for (let at = 0; at < 16; at++) await write(`src/lib/part-${at}.ts`, lines(3));
  for (let at = 0; at < 20; at++) await write(`docs/adr/${at}.md`, lines(3));
  const { status, out } = check();
  assert.equal(status, 1);
  assert.match(out, /src\/lib\/ has 16 source files: split it/);
  assert.doesNotMatch(out, /docs\/adr/);
});

test("a listed file passes at its size and fails once it grows", async () => {
  await write("src/sessions.ts", lines(512));
  await listed({ files: { "src/sessions.ts": 512 } });
  assert.equal(check().status, 0);

  await write("src/sessions.ts", lines(530));
  const { status, out } = check();
  assert.equal(status, 1);
  assert.match(out, /src\/sessions\.ts has grown to 530 lines \(listed at 512\)/);
});

test("a listed file or folder that shrank fails until --update lowers its entry", async () => {
  await write("src/sessions.ts", lines(480));
  await write("src/small.ts", lines(20));
  await listed({ files: { "src/sessions.ts": 512, "src/small.ts": 450, "src/gone.ts": 600 } });
  const { status, out } = check();
  assert.equal(status, 1);
  assert.match(out, /--update/);

  assert.equal(check("--update").status, 0);
  const list = JSON.parse(await readFile(join(root, LIST), "utf8"));
  assert.deepEqual(list.files, { "src/sessions.ts": 480 });
  assert.equal(check().status, 0);
});

test("--update never adds a file or raises an entry", async () => {
  await write("src/sessions.ts", lines(530));
  await write("src/new.ts", lines(450));
  await listed({ files: { "src/sessions.ts": 512 } });
  assert.equal(check("--update").status, 1);
  const list = JSON.parse(await readFile(join(root, LIST), "utf8"));
  assert.deepEqual(list.files, { "src/sessions.ts": 512 });
});

test("--baseline records every file and folder over today, for a repo taking the check on", async () => {
  await write("src/sessions.ts", lines(530));
  for (let at = 0; at < 17; at++) await write(`src/lib/part-${at}.ts`, lines(3));
  assert.equal(check("--baseline").status, 0);
  const list = JSON.parse(await readFile(join(root, LIST), "utf8"));
  assert.deepEqual(list, { files: { "src/sessions.ts": 530 }, folders: { "src/lib": 17 } });
  assert.equal(check().status, 0);
});

test("reads the list from another path when given one", async () => {
  await write("src/sessions.ts", lines(530));
  await write("scripts/size/allowed.json", JSON.stringify({ files: { "src/sessions.ts": 530 } }));
  assert.equal(check("scripts/size/allowed.json").status, 0);
});

test("fails a list that isn't a list of sizes", async () => {
  await write(LIST, JSON.stringify({ files: { "src/a.ts": "big" } }));
  const { status, out } = check();
  assert.equal(status, 1);
  assert.match(out, /scripts\/check-size\.json/);
});
