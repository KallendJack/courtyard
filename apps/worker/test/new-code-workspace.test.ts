import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  GitHubRepoList,
  NewRepoMade,
  NewRepoOffer,
  WorkspaceDetail,
  WorkspaceSummary,
} from "@courtyard/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFakePaperFiles, type FakePaperFiles } from "../src/integrations/paper/fake.ts";
import {
  asOwner,
  codeRepo,
  codeWorkspace,
  createFakeGitHub,
  errorOf,
  type FakeGitHub,
  gitIn,
  MATT_TEST_SKILLS,
  mattSkillsIn,
  postJson,
  type Requester,
  removeTestFolder,
  testWorker,
  writeMattPlugin,
} from "./testing.ts";

// A code workspace made from the app (#258): New workspace → Code lists the owner's GitHub repos
// that Courtyard's GitHub App reaches, and picking one gets it onto the worker machine, in the
// data folder's `repos/`, before the workspace is made on it.

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "courtyard-"));
  await mkdir(join(root, "context"));
});

afterEach(async () => {
  await removeTestFolder(root);
});

/** Signs in to the fake GitHub from Connections, as the owner does with a device code. */
const signIn = async (request: Requester, github: FakeGitHub) => {
  await postJson(request, "/api/github/sign-in", {});
  github.approve();
  await expect
    .poll(async () => ((await (await request("/api/github")).json()) as { kind: string }).kind)
    .toBe("signed-in");
};

/**
 * A repository on GitHub, standing in as a bare repository on disk with one commit on `main`:
 * its README.
 */
const remoteRepo = async (name: string) => {
  const remote = join(root, `${name}.git`);
  const pusher = join(root, `${name}-pusher`);
  await mkdir(remote, { recursive: true });
  await gitIn(remote, "init", "--quiet", "--bare", "--initial-branch=main");
  await gitIn(root, "clone", "--quiet", remote, pusher);
  await writeFile(join(pusher, "README.md"), `# ${name}\n`);
  await gitIn(pusher, "add", ".");
  await gitIn(pusher, "commit", "--quiet", "-m", "Start");
  await gitIn(pusher, "push", "--quiet", "origin", "main");
  return remote;
};

const reposOf = async (request: Requester) => {
  const response = await request("/api/github/repos");
  expect(response.status).toBe(200);
  return GitHubRepoList.parse(await response.json()).repos;
};

describe("the owner's repos", () => {
  it("lists the repos Courtyard's GitHub App reaches, each with its description, and marks the ones already a code workspace's", async () => {
    // Side project is a code workspace already, on a checkout of octo-owner/side-project.
    const { repo } = await codeRepo(root);
    await codeWorkspace(root, "side-project", repo);
    const github = createFakeGitHub({
      repos: [
        {
          fullName: "octo-owner/garrett-kitchens",
          description: "Website for a kitchen fitter",
          private: true,
        },
        { fullName: "octo-owner/side-project", private: false },
        { fullName: "octo-owner/stacks", private: true },
      ],
    });
    const request = await asOwner(testWorker({ root, github: github.api }));
    await signIn(request, github);

    expect(await reposOf(request)).toEqual([
      {
        repo: "octo-owner/garrett-kitchens",
        name: "garrett-kitchens",
        description: "Website for a kitchen fitter",
        private: true,
        added: false,
      },
      {
        repo: "octo-owner/stacks",
        name: "stacks",
        description: null,
        private: true,
        added: false,
      },
      // The ones already added come last.
      {
        repo: "octo-owner/side-project",
        name: "side-project",
        description: null,
        private: false,
        added: true,
      },
    ]);
  });

  it("says to sign in to GitHub first, while no one is signed in", async () => {
    const github = createFakeGitHub();
    const request = await asOwner(testWorker({ root, github: github.api }));

    const response = await request("/api/github/repos");

    expect(response.status).toBe(409);
    expect(await errorOf(response)).toMatch(/Sign in to GitHub from Connections/);
  });
});

describe("a code workspace made from a picked repo", () => {
  it("gets the repo onto the worker machine in the data folder, makes the workspace on it, and the repo shows as added", async () => {
    const remote = await remoteRepo("garrett-kitchens");
    const github = createFakeGitHub({
      repos: [{ fullName: "octo-owner/garrett-kitchens", private: true, cloneUrl: remote }],
    });
    const request = await asOwner(testWorker({ root, github: github.api }));
    await signIn(request, github);

    const response = await postJson(request, "/api/workspaces", {
      name: "Garrett Kitchens",
      intro: "Website for a kitchen fitter",
      repo: "octo-owner/garrett-kitchens",
    });

    expect(response.status).toBe(201);
    const made = WorkspaceSummary.parse(await response.json());
    expect(made).toMatchObject({ id: "garrett-kitchens", mode: "code", icon: "code" });
    const clone = resolve(root, "data", "repos", "octo-owner", "garrett-kitchens");
    expect(await gitIn(clone, "log", "-1", "--format=%s")).toBe("Start");
    expect(await readFile(join(clone, "README.md"), "utf8")).toMatch(/^# garrett-kitchens\r?\n$/);
    const config: unknown = JSON.parse(
      await readFile(join(root, "context", "garrett-kitchens", "workspace.json"), "utf8"),
    );
    // Its name and one line live in its workspace.json: a code workspace has no context file (#301).
    expect(config).toMatchObject({
      name: "Garrett Kitchens",
      mode: "code",
      repoPath: clone,
      description: "Website for a kitchen fitter",
    });
    expect(existsSync(join(root, "context", "garrett-kitchens", "CONTEXT.md"))).toBe(false);
    // No token is kept in the clone's git settings: git asks Courtyard's sign-in each time.
    const gitConfig = await readFile(join(clone, ".git", "config"), "utf8");
    expect(gitConfig).not.toContain(github.token() ?? "no token");
    expect(gitConfig).not.toContain("ghu_");

    const detail = WorkspaceDetail.parse(
      await (await request("/api/workspaces/garrett-kitchens")).json(),
    );
    expect(detail).toMatchObject({
      workspace: { name: "Garrett Kitchens" },
      contextFile: null,
      description: "Website for a kitchen fitter",
    });
    expect(await reposOf(request)).toEqual([expect.objectContaining({ added: true })]);
  });

  it("uses the copy already in the data folder rather than getting it again", async () => {
    const remote = await remoteRepo("stacks");
    const github = createFakeGitHub({
      repos: [{ fullName: "octo-owner/stacks", private: true, cloneUrl: remote }],
    });
    const request = await asOwner(testWorker({ root, github: github.api }));
    await signIn(request, github);
    const clone = join(root, "data", "repos", "octo-owner", "stacks");
    await mkdir(join(root, "data", "repos", "octo-owner"), { recursive: true });
    await gitIn(root, "clone", "--quiet", remote, clone);
    await writeFile(join(clone, "notes.txt"), "Left here\n");

    const response = await postJson(request, "/api/workspaces", {
      name: "Stacks",
      repo: "octo-owner/stacks",
    });

    expect(response.status).toBe(201);
    expect(await readFile(join(clone, "notes.txt"), "utf8")).toBe("Left here\n");
  });

  it("refuses a repo that's a code workspace's already, and one the GitHub App doesn't reach", async () => {
    const { repo } = await codeRepo(root);
    await codeWorkspace(root, "side-project", repo);
    const github = createFakeGitHub({ repos: [{ fullName: "octo-owner/side-project" }] });
    const request = await asOwner(testWorker({ root, github: github.api }));
    await signIn(request, github);

    const added = await postJson(request, "/api/workspaces", {
      name: "Side project again",
      repo: "octo-owner/side-project",
    });
    const unreached = await postJson(request, "/api/workspaces", {
      name: "Elsewhere",
      repo: "someone-else/elsewhere",
    });

    expect(added.status).toBe(409);
    expect(await errorOf(added)).toBe("The side-project workspace works on side-project already.");
    expect(unreached.status).toBe(400);
    expect(await errorOf(unreached)).toMatch(/GitHub App doesn't reach someone-else\/elsewhere/);
  });

  it("says why when the repo can't be got onto the worker machine, and makes no workspace", async () => {
    const github = createFakeGitHub({
      repos: [{ fullName: "octo-owner/gone", cloneUrl: join(root, "nowhere.git") }],
    });
    const request = await asOwner(testWorker({ root, github: github.api }));
    await signIn(request, github);

    const response = await postJson(request, "/api/workspaces", {
      name: "Gone",
      repo: "octo-owner/gone",
    });

    expect(response.status).toBe(502);
    expect(await errorOf(response)).toMatch(
      /^octo-owner\/gone couldn't be got onto this machine: /,
    );
    expect((await (await request("/api/workspaces/gone")).json()) as unknown).toMatchObject({
      error: expect.any(String),
    });
  });
});

describe("New repo (#391)", () => {
  /** What his setup skill writes from, in a stand-in for his plugin: the house answers' templates. */
  const TEMPLATES = {
    "issue-tracker-github.md": "# Issue tracker: GitHub\n",
    "issue-tracker-local.md": "# Issue tracker: Local Markdown\n",
    "triage-labels.md": "# Triage Labels\n",
    "domain.md": "# Domain Docs\n\nRead `CONTEXT.md` at the root.\n",
  };

  /**
   * A worker with Matt's skills, signed in to a fake GitHub that makes each new repo as a bare
   * repository on disk; with Paper on the worker machine when a test gives it.
   */
  const owner = async (more: { paper?: FakePaperFiles } = {}) => {
    const plugin = join(root, "matt-plugin");
    await writeMattPlugin(plugin, {
      skills: [
        ...MATT_TEST_SKILLS,
        { name: "setup-matt-pocock-skills", ownerStarts: true, files: TEMPLATES },
      ],
    });
    const github = createFakeGitHub({
      repos: [{ fullName: "octo-owner/side-project", private: false }],
      makesReposIn: join(root, "github"),
    });
    const request = await asOwner(
      testWorker({
        root,
        github: github.api,
        mattSkills: await mattSkillsIn(plugin),
        ...(more.paper === undefined ? {} : { paperFiles: more.paper.paper }),
        ...(more.paper === undefined ? {} : { env: { COURTYARD_PAPER_COMMAND: "/path/to/paper" } }),
      }),
    );
    await signIn(request, github);
    return { github, request };
  };

  const BIKES = {
    name: "bike-servicing",
    intro: "Track servicing for both bikes: parts, intervals and shop visits",
    private: true,
    paper: true,
  };

  it("says which account a new repo goes on, and whether Courtyard can make it a Paper file", async () => {
    const { request } = await owner({ paper: createFakePaperFiles() });

    const response = await request("/api/github/repos/new");

    expect(response.status).toBe(200);
    expect(NewRepoOffer.parse(await response.json())).toEqual({
      account: "octo-owner",
      paper: true,
    });
  });

  it("makes the repo on the owner's account on the house standard, a code workspace on it, and its Paper file", async () => {
    const paper = createFakePaperFiles();
    const { github, request } = await owner({ paper });

    const response = await postJson(request, "/api/github/repos/new", BIKES);

    expect(response.status).toBe(201);
    const made = NewRepoMade.parse(await response.json());
    expect(made.workspace).toMatchObject({ name: "Bike Servicing", mode: "code" });
    expect(made.paper).toEqual({ kind: "made", name: "Bike Servicing" });
    expect(paper.files().map((file) => file.name)).toEqual(["Bike Servicing"]);

    // On GitHub: private, described, its labels and first milestone, and its first idea, needing
    // a grill, on the milestone's Build order line: what Next up offers Grill on (#363).
    const remote = join(root, "github", "octo-owner", "bike-servicing.git");
    const onMain = (path: string) => gitIn(remote, "show", `main:${path}`);
    const agents = await onMain("AGENTS.md");
    expect(agents).toContain("# Bike Servicing");
    expect(agents).toContain(BIKES.intro);
    expect(agents).toContain("## House rules");
    expect(agents).toContain("adds CI");
    expect(agents).toContain("## Agent skills");
    expect(await onMain("docs/agents/issue-tracker.md")).toBe("# Issue tracker: GitHub");
    expect(await onMain("docs/agents/triage-labels.md")).toBe("# Triage Labels");
    expect(await onMain("docs/agents/domain.md")).toBe(
      "# Domain Docs\n\nRead `GLOSSARY.md` at the root.",
    );
    expect(await onMain("GLOSSARY.md")).toContain("# Glossary");
    expect(await onMain("docs/adr/README.md")).toContain("# Decisions");
    expect(new Set(github.labelsOf("octo-owner/bike-servicing"))).toEqual(
      // GitHub's own default labels stay, and the triage labels join them.
      new Set([
        "bug",
        "documentation",
        "enhancement",
        "needs-triage",
        "needs-info",
        "ready-for-agent",
        "ready-for-human",
        "wontfix",
      ]),
    );
    expect(github.issuesFiled()).toEqual([
      {
        number: 1,
        title: BIKES.intro,
        body: expect.stringContaining("Grill it"),
        labels: ["enhancement", "needs-triage"],
        milestone: "1 · Start",
      },
    ]);
    expect(github.milestoneDescription("octo-owner/bike-servicing", "1 · Start")).toBe(
      "Build order: #1.",
    );
    expect(github.repoMade("octo-owner/bike-servicing")).toEqual({
      description: BIKES.intro,
      private: true,
    });

    // On the worker machine: in the data folder, a clone of it, and it's added.
    const folder = resolve(root, "data", "repos", "octo-owner", "bike-servicing");
    expect(await gitIn(folder, "log", "--format=%s")).toBe("Start on the house standard");
    expect(await gitIn(folder, "status", "--porcelain", "--branch")).toBe("## main...origin/main");
    const detail = WorkspaceDetail.parse(
      await (await request(`/api/workspaces/${made.workspace.id}`)).json(),
    );
    expect(detail.workspace.name).toBe("Bike Servicing");
    expect((await reposOf(request)).find((repo) => repo.name === "bike-servicing")).toMatchObject({
      added: true,
    });
  });

  it("makes no Paper file when the owner turns it off, and a public repo when asked", async () => {
    const paper = createFakePaperFiles();
    const { github, request } = await owner({ paper });

    const response = await postJson(request, "/api/github/repos/new", {
      ...BIKES,
      private: false,
      paper: false,
    });

    expect(response.status).toBe(201);
    expect(NewRepoMade.parse(await response.json()).paper).toEqual({ kind: "skipped" });
    expect(paper.files()).toEqual([]);
    expect(github.repoMade("octo-owner/bike-servicing")).toMatchObject({ private: false });
  });

  it("refuses a name whose folder is in the data folder already, leaving it as it is", async () => {
    const { github, request } = await owner();
    const folder = join(root, "data", "repos", "octo-owner", "bike-servicing");
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, "work.txt"), "Not pushed yet\n");

    const response = await postJson(request, "/api/github/repos/new", BIKES);

    expect(response.status).toBe(409);
    expect(await readFile(join(folder, "work.txt"), "utf8")).toBe("Not pushed yet\n");
    expect(github.repoMade("octo-owner/bike-servicing")).toBeUndefined();
  });

  it("refuses a new repo while Matt's skills aren't on the worker, making nothing", async () => {
    const github = createFakeGitHub({ makesReposIn: join(root, "github") });
    const request = await asOwner(testWorker({ root, github: github.api }));
    await signIn(request, github);

    const response = await postJson(request, "/api/github/repos/new", BIKES);

    expect(response.status).toBe(409);
    expect(await errorOf(response)).toMatch(/Matt Pocock's skills/);
    expect(github.repoMade("octo-owner/bike-servicing")).toBeUndefined();
  });

  it("refuses a repo name longer than a workspace's", async () => {
    const { github, request } = await owner();

    const response = await postJson(request, "/api/github/repos/new", {
      ...BIKES,
      name: "b".repeat(61),
    });

    expect(response.status).toBe(400);
    expect(github.repoMade(`octo-owner/${"b".repeat(61)}`)).toBeUndefined();
  });

  it("refuses a name the owner has a repo by already, and one a workspace has, making nothing", async () => {
    const { github, request } = await owner();
    await mkdir(join(root, "context", "bike-servicing"), { recursive: true });
    await writeFile(join(root, "context", "bike-servicing", "workspace.json"), "{}");

    const taken = await postJson(request, "/api/github/repos/new", {
      ...BIKES,
      name: "side-project",
    });
    const workspace = await postJson(request, "/api/github/repos/new", BIKES);

    expect(taken.status).toBe(409);
    expect(await errorOf(taken)).toBe(
      "There's a repo called side-project on your account, or on this machine, already.",
    );
    expect(workspace.status).toBe(409);
    expect(github.repoMade("octo-owner/bike-servicing")).toBeUndefined();
  });
});
