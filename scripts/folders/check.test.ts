// The folders guard (#445, #453), run as `pnpm check` runs it, against two apps and docs made up here.
//
//   node --test scripts/folders/check.test.ts

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";

const CHECK = join(import.meta.dirname, "check.ts");

let root = "";
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "courtyard-folders-check-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const OVERVIEW = `# At a glance

### 🤖 Talking to the models

**Worker features:** \`sessions\` ·
\`waiting\`

**Web features:** \`sessions\`

You ask:
`;

const ARCHITECTURE =
  "- **`sessions/`:** … - **`waiting/`:** … - **`owner/`:** … - **`github/`:** …";

const WORKER = [
  "worker/features/sessions/index.ts",
  "worker/features/waiting/index.ts",
  "worker/auth/owner/index.ts",
  "worker/integrations/github/index.ts",
  "worker/lib/files.ts",
  "worker/worker.ts",
];
const WEB = ["web/features/sessions/page.tsx", "web/components/button.tsx", "web/main.tsx"];

/** Runs the guard on apps made of these files and on these docs; what it says, and whether it passed. */
const check = async ({
  files = [...WORKER, ...WEB],
  overview = OVERVIEW,
  architecture = ARCHITECTURE,
}: {
  files?: readonly string[];
  overview?: string;
  architecture?: string;
} = {}) => {
  for (const app of ["worker", "web"]) await mkdir(join(root, app), { recursive: true });
  for (const file of files) {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await writeFile(join(root, file), "");
  }
  await writeFile(join(root, "overview.md"), overview);
  await writeFile(join(root, "architecture.md"), architecture);
  const run = spawnSync(
    process.execPath,
    [
      CHECK,
      join(root, "worker"),
      join(root, "web"),
      join(root, "overview.md"),
      join(root, "architecture.md"),
    ],
    { encoding: "utf8" },
  );
  return { passed: run.status === 0, said: `${run.stdout}${run.stderr}` };
};

test("passes apps in their own folders, each feature listed and described", async () => {
  assert.deepEqual(await check(), { passed: true, said: "" });
});

test("fails a folder or a loose file at the top that isn't one of the app's own", async () => {
  const { passed, said } = await check({
    files: [...WORKER, ...WEB, "worker/agent/limits/index.ts", "web/when.ts"],
  });
  assert.equal(passed, false);
  assert.match(said, /Worker: agent\/ isn't one of its folders/);
  assert.match(said, /Web: when\.ts belongs in one of its folders/);
});

test("fails a feature the overview doesn't list for its app", async () => {
  const { passed, said } = await check({
    files: [...WORKER, ...WEB, "web/features/waiting/view.tsx"],
  });
  assert.equal(passed, false);
  assert.match(said, /Web: features\/waiting\/ isn't listed in docs\/overview\.md/);
});

test("fails a listed feature with no folder", async () => {
  const { passed, said } = await check({
    files: WORKER.filter((file) => !file.includes("waiting")).concat(WEB),
  });
  assert.equal(passed, false);
  assert.match(
    said,
    /Worker: docs\/overview\.md lists waiting, but there's no features\/waiting\//,
  );
});

test("fails a worker feature, auth or integrations folder the architecture doesn't describe", async () => {
  const { passed, said } = await check({
    architecture: "- **`sessions/`:** … - **`waiting/`:** …",
  });
  assert.equal(passed, false);
  assert.match(said, /Worker: auth\/owner\/ isn't described in docs\/architecture\.md/);
  assert.match(said, /Worker: integrations\/github\/ isn't described/);
});
