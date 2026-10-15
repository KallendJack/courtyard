// The areas guard (#445), run as `pnpm check` runs it, against a worker and docs made up here.
//
//   node --test scripts/areas/check.test.ts

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";

const CHECK = join(import.meta.dirname, "check.ts");

let root = "";
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "courtyard-areas-check-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const OVERVIEW = `# At a glance

### 🤖 agent: talking to the models

\`sessions\` · \`providers\`

You ask:

### 🔒 security: the edges

\`allow-all\`

### 📜 contract: the shared shapes

\`packages/contract\`
`;

const ARCHITECTURE = "- **`sessions/`:** … - **`providers/`:** … - **`allow-all/`:** …";

/** Runs the guard on a worker with these module folders and these docs; what it says, and whether it passed. */
const check = async ({
  folders,
  overview = OVERVIEW,
  architecture = ARCHITECTURE,
}: {
  folders: readonly string[];
  overview?: string;
  architecture?: string;
}) => {
  for (const folder of folders) await mkdir(join(root, "src", folder), { recursive: true });
  await writeFile(join(root, "src", "worker.ts"), "");
  await writeFile(join(root, "overview.md"), overview);
  await writeFile(join(root, "architecture.md"), architecture);
  const run = spawnSync(
    process.execPath,
    [CHECK, join(root, "src"), join(root, "overview.md"), join(root, "architecture.md")],
    { encoding: "utf8" },
  );
  return { passed: run.status === 0, said: `${run.stdout}${run.stderr}` };
};

const MATCHING = ["agent/sessions", "agent/providers", "security/allow-all"];

test("passes modules in the areas the overview lists them under, each in the architecture", async () => {
  assert.deepEqual(await check({ folders: MATCHING }), { passed: true, said: "" });
});

test("fails a folder that isn't an area", async () => {
  const { passed, said } = await check({ folders: [...MATCHING, "workspace-files"] });
  assert.equal(passed, false);
  assert.match(said, /workspace-files\/ isn't one of the areas/);
});

test("fails a module the overview doesn't list, or lists under another area", async () => {
  const { passed, said } = await check({
    folders: [...MATCHING, "agent/tidy", "security/sessions"],
    architecture: `${ARCHITECTURE} \`tidy/\``,
  });
  assert.equal(passed, false);
  assert.match(said, /agent\/tidy\/ isn't listed in docs\/overview\.md/);
  assert.match(said, /security\/sessions\/ is listed under agent/);
});

test("fails a module the architecture doesn't describe", async () => {
  const { passed, said } = await check({
    folders: MATCHING,
    architecture: "- **`sessions/`:** … - **`providers/`:** …",
  });
  assert.equal(passed, false);
  assert.match(said, /security\/allow-all\/ isn't described in docs\/architecture\.md/);
});

test("fails an overview entry with no folder", async () => {
  const { passed, said } = await check({ folders: ["agent/sessions", "security/allow-all"] });
  assert.equal(passed, false);
  assert.match(said, /lists providers under agent, but there's no such folder/);
});
