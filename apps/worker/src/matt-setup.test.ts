import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitHubConnection, MattSetup } from "@courtyard/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  asOwner,
  codeRepo,
  codeWorkspace,
  createFakeGitHub,
  type FakeGitHub,
  gitIn,
  MATT_TEST_SKILLS,
  mattSkillsIn,
  postJson,
  type Requester,
  testWorker,
  writeMattPlugin,
} from "./testing.ts";

// The setup check (#181): a code workspace's repository needs the files Matt Pocock's setup skill
// writes, and the triage labels, before his skills that file and triage issues work. Courtyard
// offers what's missing as one approval, never as a conversation.

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
  "domain.md": "# Domain Docs\n",
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

const TRIAGE_LABELS = [
  "needs-triage",
  "needs-info",
  "ready-for-agent",
  "ready-for-human",
  "wontfix",
];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "courtyard-"));
  ({ repo, origin } = await codeRepo(root));
  await codeWorkspace(root, "side-project", repo);
  await mkdir(join(root, "context", "garage-gym"), { recursive: true });
  await writeMattPlugin(pluginDir(), {
    skills: [
      ...MATT_TEST_SKILLS,
      { name: "setup-matt-pocock-skills", ownerStarts: true, files: TEMPLATES },
    ],
  });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 5 });
});

/** A worker with Matt's skills, signed in to GitHub, whose repository has these labels. */
const owner = async (labels: readonly string[] = ["bug", "needs-triage"]) => {
  github = createFakeGitHub({ labels: { "octo-owner/side-project": labels } });
  const request = await asOwner(
    testWorker({ root, github: github.api, mattSkills: await mattSkillsIn(pluginDir()) }),
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

const answer = async (request: Requester, given: "allow" | "not-now") => {
  const response = await postJson(request, "/api/workspaces/side-project/matt-setup", {
    answer: given,
  });
  expect(response.status).toBe(200);
  return MattSetup.parse(await response.json());
};

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

describe("the setup check", () => {
  it("offers exactly what a repository is missing of Matt's setup", async () => {
    await onMain({
      "docs/agents/domain.md": "Ours.\n",
      "CLAUDE.md": `# Side project\n\n${AGENT_SKILLS}`,
    });
    const request = await owner();

    expect(await setupOf(request)).toEqual({
      state: "offered",
      missing: [
        { kind: "file", path: "docs/agents/issue-tracker.md" },
        { kind: "file", path: "docs/agents/triage-labels.md" },
        { kind: "labels", names: ["needs-info", "ready-for-agent", "ready-for-human", "wontfix"] },
      ],
    });
  });

  it("offers nothing on a repository already set up, as Courtyard's own is", async () => {
    await onMain({
      "docs/agents/issue-tracker.md": "Ours.\n",
      "docs/agents/triage-labels.md": "Ours.\n",
      "docs/agents/domain.md": "Ours.\n",
      "AGENTS.md": `# Side project\n\n${AGENT_SKILLS}`,
    });
    const request = await owner([...TRIAGE_LABELS, "bug"]);

    expect(await setupOf(request)).toEqual({ state: "none" });
    // A planning workspace has no repository to check.
    expect(await setupOf(request, "garage-gym")).toEqual({ state: "none" });
  });

  it("on Allow, makes the labels, and adds the files on a branch of its own with a pull request", async () => {
    const request = await owner();
    const offered = await setupOf(request);

    const opened = await answer(request, "allow");

    expect(offered).toMatchObject({ state: "offered" });
    expect(opened).toEqual({
      state: "opened",
      pullRequest: { number: 1, url: "https://github.com/octo-owner/side-project/pull/1" },
      labelsMade: ["needs-info", "ready-for-agent", "ready-for-human", "wontfix"],
    });
    expect(github.labelsOf("octo-owner/side-project")).toEqual(["bug", ...TRIAGE_LABELS]);
    const [branch] = (
      await gitIn(origin, "branch", "--list", "courtyard/*", "--format=%(refname:short)")
    )
      .split("\n")
      .filter((name) => name !== "");
    expect(github.pullRequestFrom(branch ?? "")).toBe(1);
    const shown = (path: string) => gitIn(origin, "show", `${branch}:${path}`);
    // His templates for the house answers, word for word, and the Agent skills section.
    expect(await shown("docs/agents/issue-tracker.md")).toBe("# Issue tracker: GitHub");
    expect(await shown("docs/agents/triage-labels.md")).toBe("# Triage Labels");
    expect(await shown("docs/agents/domain.md")).toBe("# Domain Docs");
    expect(await shown("AGENTS.md")).toBe(AGENT_SKILLS.trim());
    // The owner's checkout is as it was, and nothing is offered again.
    expect(await gitIn(repo, "status", "--porcelain")).toBe("");
    expect(await readFile(join(repo, "README.md"), "utf8")).toBe("# A project\n");
    expect(await setupOf(request)).toEqual({ state: "none" });
  });

  it("adds the Agent skills section to the end of the AGENTS.md there is", async () => {
    await onMain({ "AGENTS.md": "# Side project\n\nOur rules.\n" });
    const request = await owner([...TRIAGE_LABELS]);

    await answer(request, "allow");

    const branch = (
      await gitIn(origin, "branch", "--list", "courtyard/*", "--format=%(refname:short)")
    ).trim();
    expect(await gitIn(origin, "show", `${branch}:AGENTS.md`)).toBe(
      `# Side project\n\nOur rules.\n\n${AGENT_SKILLS}`.trim(),
    );
  });

  it("on Not now, isn't offered again", async () => {
    const request = await owner();

    expect(await answer(request, "not-now")).toEqual({ state: "none" });
    expect(await setupOf(request)).toEqual({ state: "none" });
    expect(github.labelsOf("octo-owner/side-project")).toEqual(["bug", "needs-triage"]);
  });
});
