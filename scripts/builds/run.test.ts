// The machine's builds lock (#306), as the repo's `verify`, `test`, `e2e` and `build` scripts take
// it: real runs of the script, on a lock folder made up here, never the machine's own.
//
//   node --test scripts/builds/

import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { pathToFileURL } from "node:url";

const RUN = join(import.meta.dirname, "run.ts");
const BUILDS = pathToFileURL(join(import.meta.dirname, "../../packages/builds/index.ts")).href;

let root = "";
let lockDir = "";
const started: ChildProcess[] = [];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "courtyard-builds-"));
  lockDir = join(root, "lock");
  // Holds its place until a file named `release` turns up beside it (or half a minute, so none is
  // ever left running), saying whether its caller gave it a place.
  await writeFile(
    join(root, "hold.mjs"),
    `import { existsSync } from "node:fs";
console.log("held: " + (process.env.COURTYARD_BUILD_HELD ?? "no"));
setInterval(() => { if (existsSync("release")) process.exit(0); }, 50);
setTimeout(() => process.exit(1), 30000);
`,
  );
  // Takes a place and ends without freeing it, as a run that crashed does.
  await writeFile(
    join(root, "crash.mjs"),
    `import { takePlace } from ${JSON.stringify(BUILDS)};
await takePlace({ dir: ${JSON.stringify(lockDir)}, atOnce: 1 }, { label: "crashed" });
process.exit(0);
`,
  );
});

afterEach(async () => {
  for (const child of started.splice(0)) child.kill();
  await rm(root, { recursive: true, force: true });
});

/**
 * A run of the script in the test's folder, as a run outside any other's (whatever ran these
 * tests holds a place): what it has said so far, and how it ended.
 */
const run = (command: string, env: Readonly<Record<string, string>> = {}) => {
  const child = spawn(process.execPath, [RUN, command], {
    cwd: root,
    env: { ...process.env, COURTYARD_BUILD_HELD: "", COURTYARD_BUILDS_LOCK_DIR: lockDir, ...env },
  });
  started.push(child);
  let said = "";
  child.stdout.on("data", (chunk) => {
    said += chunk;
  });
  child.stderr.on("data", (chunk) => {
    said += chunk;
  });
  const ended = new Promise<number | null>((resolve) => child.on("close", resolve));
  return { child, said: () => said, ended, exited: () => child.exitCode !== null };
};

/** Waits for `check` to hold, for up to 15 seconds. */
const until = async (check: () => boolean, what: string) => {
  const by = Date.now() + 15_000;
  while (!check()) {
    if (Date.now() > by) assert.fail(`Never happened: ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};

const release = () => writeFile(join(root, "release"), "");

/** A command that says `what` and ends. */
const say = (what: string) => `node -e "console.log('${what}')"`;

test("runs its command, passing on how it ended, and frees its place", async () => {
  const failing = run(`node -e "process.exit(3)"`);
  assert.equal(await failing.ended, 3);
  assert.deepEqual(await readdir(lockDir), []);

  const passing = run("node hold.mjs");
  await release();
  assert.equal(await passing.ended, 0);
  assert.match(passing.said(), /held: 1/);
  assert.deepEqual(await readdir(lockDir), []);
});

test("waits while another run holds the place, saying who holds it and since when", async () => {
  const first = run("node hold.mjs");
  await until(() => first.said().includes("held: 1"), "the first run started");

  const second = run(say("second ran"));
  await until(() => second.said().includes("Waiting"), "the second run said it's waiting");
  assert.ok(second.said().includes(`helper ${root}`), second.said());
  assert.match(second.said(), /since \d{2}:\d{2}/);
  assert.equal(
    second
      .said()
      .split("\n")
      .filter((line) => line.includes("Waiting")).length,
    1,
  );
  assert.equal(second.exited(), false);

  await release();
  assert.equal(await first.ended, 0);
  assert.equal(await second.ended, 0);
  assert.match(second.said(), /second ran/);
});

test("goes straight through when its caller already holds a place", async () => {
  const first = run("node hold.mjs");
  await until(() => first.said().includes("held: 1"), "the first run started");

  const nested = run(say("nested ran"), { COURTYARD_BUILD_HELD: "1" });

  assert.equal(await nested.ended, 0);
  assert.match(nested.said(), /nested ran/);
  assert.doesNotMatch(nested.said(), /Waiting/);
  await release();
  await first.ended;
});

test("clears a place a crashed run left behind", async () => {
  const crash = spawn(process.execPath, [join(root, "crash.mjs")], { cwd: root });
  assert.equal(await new Promise((resolve) => crash.on("close", resolve)), 0);
  assert.equal((await readdir(lockDir)).length, 1);

  const next = run(say("next ran"));

  assert.equal(await next.ended, 0);
  assert.match(next.said(), /next ran/);
});

test("runs as many at once as COURTYARD_BUILDS_AT_ONCE allows", async () => {
  const atOnce = { COURTYARD_BUILDS_AT_ONCE: "2" };
  const first = run("node hold.mjs", atOnce);
  const second = run("node hold.mjs", atOnce);
  await until(() => first.said().includes("held: 1"), "the first run started");
  await until(() => second.said().includes("held: 1"), "the second run started");

  const third = run(say("third ran"), atOnce);
  await until(() => third.said().includes("Waiting"), "the third run said it's waiting");

  await release();
  assert.equal(await third.ended, 0);
});

test("says what's wrong with its settings rather than running", async () => {
  const wrong = run("node hold.mjs", { COURTYARD_BUILDS_AT_ONCE: "none" });
  assert.equal(await wrong.ended, 1);
  assert.match(wrong.said(), /COURTYARD_BUILDS_AT_ONCE must be a whole number, 1 or more/);
});

test("frees its place when it's told to stop", {
  skip: process.platform === "win32" && "Windows can't send a process a signal it can handle",
}, async () => {
  // `exec`, so the shell hands over to the command and the stop reaches it.
  const stopped = run("exec node hold.mjs");
  await until(() => stopped.said().includes("held: 1"), "the run started");

  stopped.child.kill("SIGTERM");

  await stopped.ended;
  assert.deepEqual(await readdir(lockDir), []);
});
