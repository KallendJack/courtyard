import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  GitHubConnection,
  MattSetup,
  type SetupCard,
  WorkspaceConnections,
} from "@courtyard/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFakePaperFiles, type FakePaperFiles } from "../src/integrations/paper/fake.ts";
import {
  asOwner,
  codeRepo,
  codeWorkspace,
  createFakeGitHub,
  type FakeGitHub,
  type FakeIssue,
  gitIn,
  MATT_TEST_SKILLS,
  mattSkillsIn,
  postJson,
  type Requester,
  removeTestFolder,
  testWorker,
  writeMattPlugin,
} from "./testing.ts";

// The setup card (#181, #323): a code workspace's repository needs the files Matt Pocock's setup
// skill writes, and the triage labels, before his skills that file and triage issues work.
// Courtyard works out the repository's own answers (where its work lives, its glossary's name) and
// offers one card, the house standard recommended, never a conversation.

let root: string;
let repo: string;
let origin: string;
let github: FakeGitHub;
const pluginDir = () => join(root, "matt-plugin");

/** What his setup skill writes from, in his plugin: the house answers' templates. */
const TEMPLATES = {
  "issue-tracker-github.md": "# Issue tracker: GitHub\n",
  "issue-tracker-gitlab.md": "# Issue tracker: GitLab\n",
  "triage-labels.md": "# Triage Labels\n",
  "domain.md": "# Domain Docs\n\nRead `CONTEXT.md` at the root.\n",
};

const AGENT_SKILLS = [
  "## Agent skills",
  "",
  "### Issue tracker",
  "",
  "GitHub Issues on this repo, through the `gh` CLI. See `docs/agents/issue-tracker.md`.",
  "",
  "### Triage labels",
  "",
  "The five default triage labels, unchanged. See `docs/agents/triage-labels.md`.",
  "",
  "### Domain docs",
  "",
  "Single-context: `GLOSSARY.md` and `docs/adr/` at the root. See `docs/agents/domain.md`.",
  "",
].join("\n");

/** The house standard's labels: GitHub's two categories, then the five triage labels. */
const TRIAGE_LABELS = [
  "enhancement",
  "needs-triage",
  "needs-info",
  "ready-for-agent",
  "ready-for-human",
  "wontfix",
];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "courtyard-"));
  ({ repo, origin } = await codeRepo(root));
  await codeWorkspace(root, "side-project", repo, { name: "Side project" });
  await mkdir(join(root, "context", "garage-gym"), { recursive: true });
  await writeMattPlugin(pluginDir(), {
    skills: [
      ...MATT_TEST_SKILLS,
      { name: "setup-matt-pocock-skills", ownerStarts: true, files: TEMPLATES },
    ],
  });
});

afterEach(async () => {
  await removeTestFolder(root);
});

/**
 * A worker with Matt's skills, signed in to GitHub, whose repository has these labels; with Paper
 * on the worker machine when a test gives it.
 */
const owner = async (
  labels: readonly string[] = ["bug", "needs-triage"],
  paper?: FakePaperFiles,
  issues: readonly FakeIssue[] = [],
) => {
  github = createFakeGitHub({
    labels: { "octo-owner/side-project": labels },
    issues: { "octo-owner/side-project": issues },
  });
  const request = await asOwner(
    testWorker({
      root,
      github: github.api,
      mattSkills: await mattSkillsIn(pluginDir()),
      ...(paper === undefined ? {} : { paperFiles: paper.paper }),
    }),
  );
  await postJson(request, "/api/github/sign-in", {});
  github.approve();
  await expect
    .poll(async () => GitHubConnection.parse(await (await request("/api/github")).json()).kind)
    .toBe("signed-in");
  return request;
};

const setupOf = async (request: Requester, workspace = "side-project") => {
  const response = await request(`/api/workspaces/${workspace}/matt-setup`);
  expect(response.status).toBe(200);
  return MattSetup.parse(await response.json());
};

const answer = async (
  request: Requester,
  given: "allow" | "not-now",
  choices: Record<string, string> = {},
) => {
  const response = await postJson(request, "/api/workspaces/side-project/matt-setup", {
    answer: given,
    ...choices,
  });
  expect(response.status).toBe(200);
  return MattSetup.parse(await response.json());
};

/** The branch the setup's pull request is from, on the remote. */
const setupBranch = async () =>
  (await gitIn(origin, "branch", "--list", "courtyard/*", "--format=%(refname:short)")).trim();

/** A file's text on the setup's branch, or `undefined` when it isn't there. */
const onBranch = async (path: string) => {
  try {
    return await gitIn(origin, "show", `${await setupBranch()}:${path}`);
  } catch {
    return undefined;
  }
};

/** A card with nothing on it but what a test gives. */
const card = (lines: Partial<SetupCard>): SetupCard => ({
  tracker: null,
  glossary: null,
  files: [],
  section: null,
  labels: [],
  paper: null,
  ...lines,
});

/** Commits `files` to the repository's main on its remote, as the owner would have. */
const onMain = async (files: Readonly<Record<string, string>>) => {
  for (const [path, text] of Object.entries(files)) {
    await mkdir(join(repo, path, ".."), { recursive: true });
    await writeFile(join(repo, path), text);
  }
  await gitIn(repo, "add", ".");
  await gitIn(repo, "commit", "--quiet", "-m", "Set up by hand");
  await gitIn(repo, "push", "--quiet", "origin", "main");
};

const BACKLOG = [
  "# Backlog",
  "",
  "## Next",
  "",
  "- [ ] Pin the fan curve",
  "- [x] Label the drives",
  "- [ ] Back up the router",
  "",
].join("\n");

describe("the setup card", () => {
  it("offers exactly what a repository is missing of Matt's setup", async () => {
    await onMain({
      "docs/agents/domain.md": "Ours.\n",
      "CLAUDE.md": `# Side project\n\n${AGENT_SKILLS}`,
    });
    const request = await owner();

    expect(await setupOf(request)).toEqual({
      state: "offered",
      card: card({
        files: ["docs/agents/issue-tracker.md", "docs/agents/triage-labels.md"],
        labels: ["enhancement", "needs-info", "ready-for-agent", "ready-for-human", "wontfix"],
      }),
    });
  });

  it("offers nothing on a repository already standard, as Courtyard's own is", async () => {
    await onMain({
      "docs/agents/issue-tracker.md": "Ours.\n",
      "docs/agents/triage-labels.md": "Ours.\n",
      "docs/agents/domain.md": "Ours.\n",
      "AGENTS.md": `# Side project\n\n${AGENT_SKILLS}`,
      // Work it keeps elsewhere, once docs/agents/ says where, is its answer already.
      "TODO.md": "- [ ] Something\n",
      "CONTEXT.md": "# Glossary\n",
    });
    const request = await owner([...TRIAGE_LABELS, "bug"]);

    expect(await setupOf(request)).toEqual({ state: "none" });
    // A planning workspace has no repository to check.
    expect(await setupOf(request, "garage-gym")).toEqual({ state: "none" });
  });

  it("gives a bare repository the house answers: makes the labels, and adds the files on a branch of its own with a pull request", async () => {
    const request = await owner();
    expect(await setupOf(request)).toEqual({
      state: "offered",
      card: card({
        files: [
          "docs/agents/issue-tracker.md",
          "docs/agents/triage-labels.md",
          "docs/agents/domain.md",
        ],
        section: { path: "AGENTS.md" },
        labels: ["enhancement", "needs-info", "ready-for-agent", "ready-for-human", "wontfix"],
      }),
    });

    const opened = await answer(request, "allow");

    expect(opened).toEqual({
      state: "opened",
      pullRequest: { number: 1, url: "https://github.com/octo-owner/side-project/pull/1" },
      labelsMade: ["enhancement", "needs-info", "ready-for-agent", "ready-for-human", "wontfix"],
      issuesFiled: 0,
      paper: { kind: "skipped" },
    });
    expect(new Set(github.labelsOf("octo-owner/side-project"))).toEqual(
      new Set(["bug", ...TRIAGE_LABELS]),
    );
    expect(github.pullRequestFrom(await setupBranch())).toBe(1);
    // His templates for the house answers, the glossary named GLOSSARY.md, and the Agent skills
    // section.
    expect(await onBranch("docs/agents/issue-tracker.md")).toBe("# Issue tracker: GitHub");
    expect(await onBranch("docs/agents/triage-labels.md")).toBe("# Triage Labels");
    expect(await onBranch("docs/agents/domain.md")).toBe(
      "# Domain Docs\n\nRead `GLOSSARY.md` at the root.",
    );
    expect(await onBranch("AGENTS.md")).toBe(AGENT_SKILLS.trim());
    // The owner's checkout is as it was, and nothing is offered again.
    expect(await gitIn(repo, "status", "--porcelain")).toBe("");
    expect(await readFile(join(repo, "README.md"), "utf8")).toBe("# A project\n");
    expect(await setupOf(request)).toEqual({ state: "none" });
  });

  it("adds the Agent skills section to the end of the AGENTS.md there is", async () => {
    await onMain({ "AGENTS.md": "# Side project\n\nOur rules.\n" });
    const request = await owner([...TRIAGE_LABELS]);

    await answer(request, "allow");

    expect(await onBranch("AGENTS.md")).toBe(
      `# Side project\n\nOur rules.\n\n${AGENT_SKILLS}`.trim(),
    );
  });

  it("finds a repository's own tracker and glossary, and recommends moving both to the house standard (#323)", async () => {
    await onMain({ "docs/backlog.md": BACKLOG, "CONTEXT.md": "# Glossary\n" });
    const request = await owner([...TRIAGE_LABELS]);

    const offered = await setupOf(request);

    expect(offered).toMatchObject({
      state: "offered",
      card: {
        tracker: { path: "docs/backlog.md", recommended: "move" },
        glossary: { path: "CONTEXT.md" },
      },
    });
  });

  it("recommends keeping a tracker the repository says another agent writes, and says why", async () => {
    await onMain({
      "docs/backlog.md": BACKLOG,
      "AGENTS.md":
        "# Stacks\n\nThe planning agent writes docs/backlog.md; don't edit it by hand.\n",
    });
    const request = await owner([...TRIAGE_LABELS]);

    expect(await setupOf(request)).toMatchObject({
      state: "offered",
      card: {
        tracker: {
          path: "docs/backlog.md",
          recommended: "keep",
          why: "the repo says another agent writes this file",
        },
      },
    });
  });

  it("on Move and Rename, files each open item as an issue, points the old file to them, and renames the glossary with its pointers", async () => {
    await onMain({
      "docs/backlog.md": BACKLOG,
      "CONTEXT.md": "# Glossary\n\n**Stack**: one compose file.\n",
      "AGENTS.md": "# Stacks\n\nWords are in CONTEXT.md.\n",
    });
    const request = await owner(["bug"]);

    const opened = await answer(request, "allow", { tracker: "move", glossary: "rename" });

    expect(opened).toMatchObject({ state: "opened", issuesFiled: 2 });
    expect(github.issuesFiled().map(({ title, labels }) => ({ title, labels }))).toEqual([
      { title: "Pin the fan curve", labels: ["needs-triage"] },
      { title: "Back up the router", labels: ["needs-triage"] },
    ]);
    const [fan, router] = github.issuesFiled();
    const backlog = await onBranch("docs/backlog.md");
    expect(backlog).toContain(`Pin the fan curve: moved to #${fan?.number}`);
    expect(backlog).toContain(`Back up the router: moved to #${router?.number}`);
    expect(backlog).toContain("- [x] Label the drives");
    expect(backlog).toContain("GitHub issues");
    expect(await onBranch("CONTEXT.md")).toBeUndefined();
    expect(await onBranch("GLOSSARY.md")).toBe("# Glossary\n\n**Stack**: one compose file.");
    expect(await onBranch("AGENTS.md")).toBe(
      `# Stacks\n\nWords are in GLOSSARY.md.\n\n${AGENT_SKILLS}`.trim(),
    );
    expect(await onBranch("docs/agents/issue-tracker.md")).toBe("# Issue tracker: GitHub");
    // Its work lives on GitHub now, so the triage labels are made.
    expect(new Set(github.labelsOf("octo-owner/side-project"))).toEqual(
      new Set(["bug", ...TRIAGE_LABELS]),
    );
  });

  it("files no item again that's an open issue already, as after a Set up that failed part way", async () => {
    await onMain({ "docs/backlog.md": BACKLOG });
    const request = await owner([...TRIAGE_LABELS, "bug"], undefined, [
      { number: 7, title: "Pin the fan curve", labels: ["needs-triage"] },
    ]);

    const opened = await answer(request, "allow", { tracker: "move" });

    expect(opened).toMatchObject({ state: "opened", issuesFiled: 1 });
    expect(github.issuesFiled().map((issue) => issue.title)).toEqual(["Back up the router"]);
    expect(await onBranch("docs/backlog.md")).toContain("Pin the fan curve: moved to #7");
  });

  it("renames only the glossary's own name in the files that point to it, never a longer name or a file that isn't text", async () => {
    await onMain({
      "CONTEXT.md": "# Glossary\n",
      "AGENTS.md": "# Stacks\n\nWords are in CONTEXT.md. Shared ones in SHARED-CONTEXT.md.\n",
      "src/names.ts": 'export const glossary = "CONTEXT.md";\n',
    });
    const request = await owner([...TRIAGE_LABELS, "bug"]);

    await answer(request, "allow", { glossary: "rename" });

    expect(await onBranch("AGENTS.md")).toContain(
      "Words are in GLOSSARY.md. Shared ones in SHARED-CONTEXT.md.",
    );
    expect(await onBranch("src/names.ts")).toBe('export const glossary = "CONTEXT.md";');
  });

  it("makes no labels for a repository whose docs/agents/ say its work lives elsewhere", async () => {
    await onMain({
      "docs/agents/issue-tracker.md":
        "# Issue tracker: docs/backlog.md\n\nWork for this repo lives in `docs/backlog.md`, not in GitHub issues.\n",
      "docs/agents/triage-labels.md": "Ours.\n",
      "docs/agents/domain.md": "Ours.\n",
      "AGENTS.md": `# Side project\n\n${AGENT_SKILLS}`,
    });
    const request = await owner(["bug"]);

    expect(await setupOf(request)).toEqual({ state: "none" });
  });

  it("on Keep, never moves or renames the file the owner kept, and records where its work lives", async () => {
    await onMain({
      "docs/backlog.md": BACKLOG,
      "CONTEXT.md": "# Glossary\n",
      "AGENTS.md": "# Stacks\n",
    });
    const request = await owner(["bug"]);

    const opened = await answer(request, "allow", { tracker: "keep", glossary: "keep" });

    expect(opened).toMatchObject({ state: "opened", labelsMade: [], issuesFiled: 0 });
    expect(github.issuesFiled()).toEqual([]);
    // Labels are made on GitHub only when its work lives there.
    expect(github.labelsOf("octo-owner/side-project")).toEqual(["bug"]);
    expect(await onBranch("docs/backlog.md")).toBe(BACKLOG.trim());
    expect(await onBranch("CONTEXT.md")).toBe("# Glossary");
    expect(await onBranch("GLOSSARY.md")).toBeUndefined();
    expect(await onBranch("docs/agents/issue-tracker.md")).toContain(
      "Work for this repo lives in `docs/backlog.md`",
    );
    expect(await onBranch("docs/agents/domain.md")).toBe(
      "# Domain Docs\n\nRead `CONTEXT.md` at the root.",
    );
    const section = await onBranch("AGENTS.md");
    expect(section).toContain("`docs/backlog.md`. See `docs/agents/issue-tracker.md`.");
    expect(section).toContain("Single-context: `CONTEXT.md` and `docs/adr/` at the root.");
  });

  it("offers a Paper file with the rest when Courtyard can make one, and connects it on Set up", async () => {
    const paper = createFakePaperFiles();
    // Paper's command comes from another code workspace that names it.
    await codeWorkspace(root, "stacks", repo, {
      connections: { paper: { command: "/path/to/paper", fileId: "file-1" } },
    });
    const request = await owner([...TRIAGE_LABELS], paper);

    expect(await setupOf(request)).toMatchObject({
      state: "offered",
      card: { paper: { name: "Side project" } },
    });
    const opened = await answer(request, "allow");

    expect(opened).toMatchObject({ paper: { kind: "made", name: "Side project" } });
    const connections = WorkspaceConnections.parse(
      await (await request("/api/workspaces/side-project/connections")).json(),
    );
    expect(connections.paper).toMatchObject({ kind: "connected", name: "Side project" });
  });

  it("makes no Paper file when the owner skips it", async () => {
    const paper = createFakePaperFiles();
    await codeWorkspace(root, "stacks", repo, {
      connections: { paper: { command: "/path/to/paper", fileId: "file-1" } },
    });
    const request = await owner([...TRIAGE_LABELS], paper);

    expect(await answer(request, "allow", { paper: "skip" })).toMatchObject({
      paper: { kind: "skipped" },
    });
    expect(paper.files()).toEqual([]);
  });

  it("on Not now, isn't offered again", async () => {
    const request = await owner();

    expect(await answer(request, "not-now")).toEqual({ state: "none" });
    expect(await setupOf(request)).toEqual({ state: "none" });
    expect(github.labelsOf("octo-owner/side-project")).toEqual(["bug", "needs-triage"]);
  });
});
