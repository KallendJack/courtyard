// The folders guard (#445, #453, #459), run as `pnpm check` runs it, against two apps, the shared
// pieces (#703) and docs made up here.
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

**Fabrication features:** \`builds\`

You ask:
`;

const READMES = [
  "worker/features/sessions/README.md",
  "worker/features/waiting/README.md",
  "worker/auth/owner/README.md",
  "worker/integrations/github/README.md",
  "worker/providers/README.md",
  "worker/prompts/README.md",
  "web/features/sessions/README.md",
  "fabrication/features/builds/README.md",
];

const ARCHITECTURE = READMES.map(
  (readme) => `- [\`x\`](../apps/${readme.replace("/", "/src/")})`,
).join("\n");

const WORKER = [
  "worker/features/sessions/index.ts",
  "worker/features/waiting/index.ts",
  "worker/auth/owner/index.ts",
  "worker/integrations/github/index.ts",
  "worker/providers/index.ts",
  "worker/prompts/index.ts",
  "worker/lib/files.ts",
  "worker/worker.ts",
  ...READMES.filter((readme) => readme.startsWith("worker/")),
];
const WEB = [
  "web/features/sessions/page.tsx",
  "web/features/sessions/README.md",
  "web/components/button.tsx",
  "web/main.tsx",
];
/** Fabrication, the second web app (#698, ADR 0036). */
const FABRICATION = [
  "fabrication/features/builds/build-page.tsx",
  "fabrication/features/builds/README.md",
  "fabrication/main.tsx",
];
/** The shared pieces both apps use (packages/ui, #703), and what's installed beside them. */
const UI = [
  "ui/buttons/button.tsx",
  "ui/reply/reply-box.tsx",
  "ui/theme.css",
  "ui/package.json",
  "ui/README.md",
  "ui/node_modules/react/index.js",
];

/** Runs the guard on apps made of these files and on these docs; what it says, and whether it passed. */
const check = async ({
  files = [...WORKER, ...WEB, ...FABRICATION, ...UI],
  overview = OVERVIEW,
  architecture = ARCHITECTURE,
}: {
  files?: readonly string[];
  overview?: string;
  architecture?: string;
} = {}) => {
  for (const app of ["worker", "web", "ui", "fabrication"]) await mkdir(join(root, app), { recursive: true });
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
      join(root, "ui"),
      join(root, "fabrication"),
    ],
    { encoding: "utf8" },
  );
  return { passed: run.status === 0, said: `${run.stdout}${run.stderr}` };
};

test("passes apps in their own folders, each feature listed with its README linked", async () => {
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

test("fails a folder or a loose file in the shared pieces that isn't one of theirs", async () => {
  const { passed, said } = await check({
    files: [...WORKER, ...WEB, ...UI, "ui/features/build/view.tsx", "ui/when.ts"],
  });
  assert.equal(passed, false);
  assert.match(said, /UI: features\/ isn't one of its folders/);
  assert.match(said, /UI: when\.ts belongs in one of its folders/);
  assert.doesNotMatch(said, /node_modules/);
});

test("checks Fabrication as the web app: its own folders, its features listed (#698)", async () => {
  const { passed, said } = await check({
    files: [
      ...WORKER,
      ...WEB,
      ...FABRICATION,
      ...UI,
      "fabrication/three/scene.ts",
      "fabrication/features/chat/README.md",
    ],
    architecture: `${ARCHITECTURE}\n- [\`x\`](../apps/fabrication/src/features/chat/README.md)`,
  });
  assert.equal(passed, false);
  assert.match(said, /Fabrication: three\/ isn't one of its folders/);
  assert.match(said, /Fabrication: features\/chat\/ isn't listed in docs\/overview\.md/);
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

test("fails a feature, auth, integrations, providers or prompts folder with no README", async () => {
  const { passed, said } = await check({
    files: [...WORKER, ...WEB].filter(
      (file) =>
        ![
          "worker/auth/owner/README.md",
          "worker/prompts/README.md",
          "web/features/sessions/README.md",
        ].includes(file),
    ),
  });
  assert.equal(passed, false);
  assert.match(said, /Worker: auth\/owner\/ has no README\.md/);
  assert.match(said, /Worker: prompts\/ has no README\.md/);
  assert.match(said, /Web: features\/sessions\/ has no README\.md/);
  assert.doesNotMatch(said, /features\/waiting\//);
});

test("fails a README the architecture doesn't link", async () => {
  const { passed, said } = await check({
    architecture: ARCHITECTURE.split("\n")
      .filter((line) => !line.includes("auth/owner") && !line.includes("web/src"))
      .join("\n"),
  });
  assert.equal(passed, false);
  assert.match(
    said,
    /Worker: docs\/architecture\.md doesn't link auth\/owner\/README\.md \(as \.\.\/apps\/worker\/src\/auth\/owner\/README\.md\)/,
  );
  assert.match(said, /Web: docs\/architecture\.md doesn't link features\/sessions\/README\.md/);
});
